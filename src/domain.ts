import { createHash, randomUUID } from 'node:crypto';

export const CUSTOMER = 'ACME';
export const PERIOD = '2026-09';
export const PARTITION = `CUSTOMER#${CUSTOMER}#PERIOD#${PERIOD}`;
export const RATE_CENTS = 1;

export type Classification = 'ON_TIME' | 'POST_CLOSE';
export interface UsageEvent {
  event_id: string;
  occurred_at: string;
  accepted_at: string;
  units: number;
  amount_cents: number;
  classification: Classification;
  epoch: number;
}
export interface Build {
  version: number;
  base_version: number;
  kind: 'CLOSE' | 'ADJUST';
  fence_epoch: number;
  started_at: string;
  operation_id: string;
}
export interface PeriodState {
  phase: 'OPEN' | 'CLOSED';
  epoch: number;
  latest_version: number;
  building?: Build;
}
export interface Snapshot {
  version: number;
  kind: Build['kind'];
  units: number;
  amount_cents: number;
  event_ids: string[];
  added_event_ids: string[];
  created_at: string;
  through_epoch: number;
}
export interface Aggregate {
  units: number;
  amount_cents: number;
  processed_events: number;
  last_processed_at: string | null;
}
export interface Receipt { event_id: string; processed_at: string }
export interface ExistingEvent { event: UsageEvent; fingerprint: string }
export interface StateContents {
  snapshots: Snapshot[];
  receipts: Receipt[];
  aggregate: Aggregate;
}

/** All conditional methods return false only for a competing state change. */
export interface Store {
  ensurePeriod(): Promise<void>;
  getPeriod(): Promise<PeriodState>;
  findEvent(eventId: string): Promise<ExistingEvent | undefined>;
  acceptEvent(event: UsageEvent, fingerprint: string, expected: PeriodState): Promise<boolean>;
  reserveBuild(expected: PeriodState, build: Build): Promise<boolean>;
  queryEvents(throughEpoch?: number): Promise<UsageEvent[]>;
  getSnapshot(version: number): Promise<Snapshot | undefined>;
  publishSnapshot(build: Build, snapshot: Snapshot): Promise<boolean>;
  stateContents(): Promise<StateContents>;
  processEvent(event: UsageEvent, processedAt: string): Promise<boolean>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_ERROR') { super(message); }
}

function validateInput(input: unknown): { event_id: string; occurred_at: string; units: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Expected a JSON object.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['event_id', 'occurred_at', 'units'].includes(key))) {
    throw new ApiError(400, 'Allowed event fields: event_id, occurred_at, units.');
  }
  if (typeof body.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.event_id)) {
    throw new ApiError(400, 'event_id must contain 1–64 letters, digits, underscores, or hyphens.');
  }
  if (typeof body.occurred_at !== 'string' || !/^2026-09-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.occurred_at)) {
    throw new ApiError(400, 'occurred_at must be a UTC ISO timestamp in September 2026, ending in Z.');
  }
  const occurred = new Date(body.occurred_at);
  const normalized = Number.isFinite(occurred.getTime()) ? occurred.toISOString() : '';
  if (!normalized.startsWith('2026-09-') || normalized.slice(0, 19) !== body.occurred_at.slice(0, 19)) {
    throw new ApiError(400, 'occurred_at must be a valid September 2026 UTC timestamp.');
  }
  if (typeof body.units !== 'number' || !Number.isSafeInteger(body.units) || body.units <= 0) {
    throw new ApiError(400, 'units must be a positive safe integer.');
  }
  return { event_id: body.event_id, occurred_at: normalized, units: body.units };
}

export function eventFingerprint(event: Pick<UsageEvent, 'event_id' | 'occurred_at' | 'units'>): string {
  return createHash('sha256').update(JSON.stringify([CUSTOMER, PERIOD, event.event_id, event.occurred_at, event.units])).digest('hex');
}

const emptyAggregate = (): Aggregate => ({ units: 0, amount_cents: 0, processed_events: 0, last_processed_at: null });
export { emptyAggregate };

export class MeterProof {
  constructor(private readonly store: Store, private readonly now: () => string = () => new Date().toISOString()) {}

  async ingest(input: unknown): Promise<{ event: UsageEvent; duplicate: boolean }> {
    const parsed = validateInput(input);
    const fingerprint = eventFingerprint(parsed);
    await this.store.ensurePeriod();
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await this.store.findEvent(parsed.event_id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'event_id already exists with a different payload.', 'IDEMPOTENCY_MISMATCH');
        return { event: existing.event, duplicate: true };
      }
      const period = await this.store.getPeriod();
      // This timestamp is sampled before the successful transaction, not a commit timestamp.
      // The transaction's phase/epoch membership, not wall-clock comparison, defines cutoff.
      const event: UsageEvent = {
        ...parsed,
        accepted_at: this.now(),
        amount_cents: parsed.units * RATE_CENTS,
        classification: period.phase === 'OPEN' ? 'ON_TIME' : 'POST_CLOSE',
        epoch: period.epoch,
      };
      if (await this.store.acceptEvent(event, fingerprint, period)) return { event, duplicate: false };
    }
    throw new ApiError(503, 'The period changed concurrently. Retry the same event_id.', 'RETRYABLE_CONFLICT');
  }

  async close(): Promise<Snapshot> {
    await this.store.ensurePeriod();
    for (let attempt = 0; attempt < 8; attempt++) {
      const original = await this.store.getSnapshot(1);
      if (original) return original; // A close retry never starts an adjustment.
      const period = await this.store.getPeriod();
      if (period.building) {
        if (period.building.kind !== 'CLOSE') throw new ApiError(409, 'Another snapshot operation is in progress.');
        return this.finishBuild(period.building);
      }
      if (period.phase !== 'OPEN' || period.latest_version !== 0) continue;
      const build: Build = {
        version: 1, base_version: 0, kind: 'CLOSE', fence_epoch: period.epoch,
        started_at: this.now(), operation_id: randomUUID(),
      };
      if (await this.store.reserveBuild(period, build)) return this.finishBuild(build);
    }
    throw new ApiError(503, 'Close is busy. Retry close to recover the same operation.', 'RETRYABLE_CONFLICT');
  }

  async adjust(input: unknown): Promise<Snapshot> {
    const expected = input && typeof input === 'object' ? (input as Record<string, unknown>).expected_version : undefined;
    if (!Number.isSafeInteger(expected) || (expected as number) < 1) {
      throw new ApiError(400, 'expected_version must identify the current closed snapshot.');
    }
    const version = expected as number;
    await this.store.ensurePeriod();
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await this.store.getSnapshot(version + 1);
      if (existing) return existing; // expected_version is also the operation's idempotency key.
      const period = await this.store.getPeriod();
      if (period.phase !== 'CLOSED' || period.latest_version !== version) {
        throw new ApiError(409, 'The latest snapshot changed. Refresh before adjusting.', 'VERSION_CONFLICT');
      }
      if (period.building) {
        if (period.building.kind !== 'ADJUST' || period.building.base_version !== version) throw new ApiError(409, 'Another snapshot operation is in progress.');
        return this.finishBuild(period.building);
      }
      const build: Build = {
        version: version + 1, base_version: version, kind: 'ADJUST', fence_epoch: period.epoch,
        started_at: this.now(), operation_id: randomUUID(),
      };
      if (await this.store.reserveBuild(period, build)) return this.finishBuild(build);
    }
    throw new ApiError(503, 'Adjustment is busy. Retry with the same expected_version.', 'RETRYABLE_CONFLICT');
  }

  private async finishBuild(build: Build): Promise<Snapshot> {
    // Once the fence is reserved, no future ingestion may append to these epochs.
    // Therefore a strongly consistent, paginated base-table Query has stable membership.
    const events = await this.store.queryEvents(build.fence_epoch);
    const prior = build.base_version ? await this.store.getSnapshot(build.base_version) : undefined;
    if (build.base_version && !prior) throw new ApiError(503, 'Prior snapshot is unavailable. Retry the same operation.', 'MISSING_PRIOR');
    const priorIds = new Set(prior?.event_ids ?? []);
    const units = events.reduce((sum, event) => sum + event.units, 0);
    if (!Number.isSafeInteger(units)) throw new ApiError(422, 'Snapshot exceeds safe integer arithmetic.');
    const snapshot: Snapshot = {
      version: build.version, kind: build.kind, units, amount_cents: units * RATE_CENTS,
      event_ids: events.map((event) => event.event_id),
      added_event_ids: events.filter((event) => !priorIds.has(event.event_id)).map((event) => event.event_id),
      created_at: build.started_at, through_epoch: build.fence_epoch,
    };
    if (await this.store.publishSnapshot(build, snapshot)) return snapshot;
    const published = await this.store.getSnapshot(build.version);
    if (published) return published;
    throw new ApiError(503, 'Snapshot publication interrupted. Retry the same operation.', 'RETRYABLE_CONFLICT');
  }

  async view() {
    await this.store.ensurePeriod();
    // Observe immutable snapshots before ledger so every displayed snapshot member
    // has a corresponding event. A concurrent publication appears on the next refresh.
    const period = await this.store.getPeriod();
    const contents = await this.store.stateContents();
    const events = await this.store.queryEvents();
    const snapshots = contents.snapshots.sort((a, b) => a.version - b.version);
    const latest = snapshots.at(-1);
    const included = new Set(latest?.event_ids ?? []);
    const pending = events.filter((event) => event.classification === 'POST_CLOSE' && !included.has(event.event_id));
    const pendingUnits = pending.reduce((sum, event) => sum + event.units, 0);
    const receiptById = new Map(contents.receipts.map((receipt) => [receipt.event_id, receipt.processed_at]));
    return {
      customer_id: CUSTOMER, period: PERIOD, phase: period.phase, rate_cents_per_unit: RATE_CENTS,
      epoch: period.epoch, latest_version: latest?.version ?? 0,
      building: period.building ? {
        version: period.building.version, kind: period.building.kind,
        fence_epoch: period.building.fence_epoch, started_at: period.building.started_at,
      } : null,
      aggregate: contents.aggregate, snapshots,
      events: events.map((event) => ({ ...event, processed_at: receiptById.get(event.event_id) ?? null })),
      pending: { units: pendingUnits, amount_cents: pendingUnits * RATE_CENTS, event_ids: pending.map((event) => event.event_id) },
    };
  }
}
