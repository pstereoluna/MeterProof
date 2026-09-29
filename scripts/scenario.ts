/**
 * Local demonstration orchestration only. This module is never imported by Lambda.
 * All metering results come from the real domain service and supplied local Store.
 * Deliberate interruption is injected through a local Store wrapper, not a production flag.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ApiError, MeterProof, type Snapshot, type Store } from '../src/domain.js';

type PeriodView = Awaited<ReturnType<MeterProof['view']>>;
type CheckValue = string | number | boolean | null | string[];
export interface ScenarioCheck { label: string; passed: boolean; actual: CheckValue; expected: CheckValue }
export interface ScenarioHistory { step: number; title: string; detail: string; checks: ScenarioCheck[] }
export interface ScenarioState { run_id: string; step: number; history: ScenarioHistory[] }
export interface ScenarioAction { id: string; title: string; description: string }
export interface ScenarioView extends ScenarioState { total_steps: 8; next_action: ScenarioAction | null; period: PeriodView }
export interface ScenarioOptions {
  createStore: (runId: string) => Store;
  initialState?: ScenarioState;
  now?: () => string;
  persist?: (state: ScenarioState) => Promise<void>;
}

export const SCENARIO_ACTIONS: readonly ScenarioAction[] = [
  { id: 'seed_lag', title: 'Accept usage; hold one delivery', description: 'Accept 100 + 250 + 400 units; process only the first two events.' },
  { id: 'close', title: 'Close while processing is behind', description: 'Derive the original snapshot from all accepted ledger events.' },
  { id: 'retry_replay', title: 'Replay the delayed event five times', description: 'Retry the 400-unit event five times and deliver it to metering five times after close.' },
  { id: 'late_batch', title: 'Accept two older events after close', description: 'Accept 100 + 200 units with older occurrence times; preserve the original snapshot.' },
  { id: 'interrupt_adjust', title: 'Interrupt an adjustment after its fence', description: 'Reserve v2, accept another 50 units beyond its fence, then deliberately interrupt before publication.' },
  { id: 'recover_adjust', title: 'Recover the reserved adjustment', description: 'Use a fresh service instance to recover v2; the newer 50 units stay pending.' },
  { id: 'final_adjust', title: 'Publish the remaining adjustment', description: 'Create v3 from the ledger and preserve both earlier snapshots.' },
  { id: 'payload_conflict', title: 'Reject an altered retry', description: 'Retry an existing event ID with 150 units instead of 100; verify HTTP 409 semantics and unchanged data.' },
];

const usage = (event_id: string, units: number, day: string) => ({ event_id, units, occurred_at: `2026-09-${day}T12:00:00Z` });
const INPUTS = [
  usage('evt_001', 100, '10'), usage('evt_002', 250, '15'), usage('evt_003', 400, '20'),
  usage('evt_004', 100, '09'), usage('evt_005', 200, '02'), usage('evt_006', 50, '07'),
] as const;
const sumLedger = (period: PeriodView) => period.events.reduce((sum, event) => sum + event.units, 0);
const snapshot = (period: PeriodView, version: number) => period.snapshots.find((item) => item.version === version);
const check = (label: string, actual: CheckValue, expected: CheckValue): ScenarioCheck => ({ label, passed: isDeepStrictEqual(actual, expected), actual, expected });
const preserved = (label: string, before: Snapshot | undefined, after: Snapshot | undefined): ScenarioCheck => check(label, Boolean(before && after && isDeepStrictEqual(before, after)), true);

export class SimulatedInterruption extends Error {
  constructor() { super('Intentional local interruption after the v2 fence and before snapshot publication.'); this.name = 'SimulatedInterruption'; }
}

/** One controller per local server process; queued operations protect step/run transitions. */
export class LocalScenarioController {
  private progress: ScenarioState | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => string;

  constructor(private readonly options: ScenarioOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.initialState) {
      const value = options.initialState;
      if (!/^[0-9a-f-]{36}$/i.test(value.run_id) || !Number.isInteger(value.step) || value.step < 0 || value.step > 8 || !Array.isArray(value.history) || value.history.length !== value.step) {
        throw new Error('Invalid local scenario checkpoint.');
      }
      this.progress = structuredClone(value);
    }
  }

  state(): ScenarioState | undefined { return this.progress ? structuredClone(this.progress) : undefined; }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async commit(next: ScenarioState) {
    // Durable metering actions are idempotent. A checkpoint write failure leaves the
    // old step active so that the same action can safely be retried after restart.
    if (this.options.persist) await this.options.persist(structuredClone(next));
    this.progress = structuredClone(next);
  }

  private async currentView(): Promise<ScenarioView | null> {
    if (!this.progress) return null;
    const state = this.state()!;
    const service = new MeterProof(this.options.createStore(state.run_id), this.now);
    return { ...state, total_steps: 8, next_action: SCENARIO_ACTIONS[state.step] ?? null, period: await service.view() };
  }

  view(): Promise<ScenarioView | null> { return this.serial(() => this.currentView()); }

  start(): Promise<ScenarioView> {
    return this.serial(async () => {
      const next: ScenarioState = { run_id: randomUUID(), step: 0, history: [] };
      await this.options.createStore(next.run_id).ensurePeriod();
      await this.commit(next);
      return (await this.currentView())!;
    });
  }

  advance(input: { run_id: string; expected_step: number }): Promise<ScenarioView> {
    return this.serial(async () => {
      if (!input || typeof input.run_id !== 'string' || !Number.isInteger(input.expected_step) || input.expected_step < 0 || input.expected_step > 8) throw new ApiError(400, 'Provide run_id and expected_step between 0 and 8.');
      const state = this.progress;
      if (!state || input.run_id !== state.run_id) throw new ApiError(409, 'The local demo run changed. Refresh before continuing.', 'DEMO_RUN_CONFLICT');
      if (input.expected_step > state.step) throw new ApiError(409, 'The demo has not reached that step. Refresh before continuing.', 'DEMO_STEP_CONFLICT');
      // Repeated POSTs acknowledge the already completed action, not the next one.
      if (input.expected_step < state.step || state.step === 8) return (await this.currentView())!;
      const store = this.options.createStore(state.run_id);
      const service = new MeterProof(store, this.now);
      const before = await service.view();
      const history = await this.perform(state.step, store, service, before);
      const failed = history.checks.filter((item) => !item.passed);
      if (failed.length) throw new ApiError(500, `Scenario invariant failed: ${failed.map((item) => item.label).join(', ')}.`, 'DEMO_INVARIANT_FAILED');
      await this.commit({ ...state, step: state.step + 1, history: [...state.history, history] });
      return (await this.currentView())!;
    });
  }

  private async perform(index: number, store: Store, service: MeterProof, before: PeriodView): Promise<ScenarioHistory> {
    const action = SCENARIO_ACTIONS[index]!;
    let detail: string;
    let checks: ScenarioCheck[] = [];
    switch (action.id) {
      case 'seed_lag': {
        for (const input of INPUTS.slice(0, 3)) await service.ingest(input);
        for (const input of INPUTS.slice(0, 2)) {
          const accepted = await store.findEvent(input.event_id);
          if (!accepted) throw new Error('Seed event missing from the ledger.');
          await store.processEvent(accepted.event, this.now());
        }
        const period = await service.view();
        checks = [check('Accepted ledger units', sumLedger(period), 750), check('Projected units', period.aggregate.units, 350),
          check('Processed events', period.aggregate.processed_events, 2), check('Delayed evt_003 has no receipt', period.events.find((event) => event.event_id === 'evt_003')?.processed_at ?? null, null)];
        detail = 'The ledger accepted all three events. The local delivery simulator deliberately withheld evt_003, leaving the projection at 350 units.';
        break;
      }
      case 'close': {
        await service.close();
        const period = await service.view();
        checks = [check('Original snapshot units', snapshot(period, 1)?.units ?? null, 750), check('Projected units still lag', period.aggregate.units, 350),
          check('Original snapshot members', snapshot(period, 1)?.event_ids ?? [], ['evt_001', 'evt_002', 'evt_003']), check('Period phase', period.phase, 'CLOSED')];
        detail = 'Close scanned the authoritative ledger behind a durable fence. The snapshot includes the delayed 400-unit event even though metering has not processed it.';
        break;
      }
      case 'retry_replay': {
        const ingestResults = [];
        const processingResults = [];
        for (let attempt = 0; attempt < 5; attempt++) ingestResults.push(await service.ingest(INPUTS[2]));
        const accepted = await store.findEvent('evt_003');
        if (!accepted) throw new Error('Delayed event missing from the ledger.');
        for (let delivery = 0; delivery < 5; delivery++) processingResults.push(await store.processEvent(accepted.event, this.now()));
        const period = await service.view();
        checks = [check('Duplicate ingestion responses', ingestResults.filter((item) => item.duplicate).length, 5),
          check('At most one delivery applied', processingResults.filter(Boolean).length <= 1, true),
          check('Ledger event count', period.events.length, 3), check('Projected units', period.aggregate.units, 750), check('Processed events', period.aggregate.processed_events, 3),
          check('Delayed event classification', period.events.find((event) => event.event_id === 'evt_003')?.classification ?? null, 'ON_TIME'),
          check('Pending adjustment units', period.pending.units, 0), preserved('Original snapshot preserved', snapshot(before, 1), snapshot(period, 1))];
        detail = 'Five ingestion retries returned the same accepted event. Five processing deliveries converged to one receipt and one increment; the event retained its ON_TIME classification after close.';
        break;
      }
      case 'late_batch': {
        await service.ingest(INPUTS[3]);
        await service.ingest(INPUTS[4]);
        const period = await service.view();
        checks = [check('Pending adjustment units', period.pending.units, 300), check('Pending event IDs', period.pending.event_ids, ['evt_004', 'evt_005']),
          check('Post-close classifications', period.events.filter((event) => ['evt_004', 'evt_005'].includes(event.event_id)).map((event) => event.classification), ['POST_CLOSE', 'POST_CLOSE']),
          check('Original snapshot units', snapshot(period, 1)?.units ?? null, 750), preserved('Original snapshot preserved', snapshot(before, 1), snapshot(period, 1))];
        detail = 'evt_004 and evt_005 occurred earlier in September but were accepted after close. Their 300 units are explicit pending usage; v1 remains 750 units.';
        break;
      }
      case 'interrupt_adjust': {
        let interrupted = false;
        let fencedIds: string[] = [];
        const faultStore = new Proxy(store, {
          get(target, property) {
            if (property === 'queryEvents') return async (throughEpoch?: number) => {
              const events = await target.queryEvents(throughEpoch);
              if (throughEpoch === 1) {
                fencedIds = events.map((event) => event.event_id);
                // This call uses the normal store/service after the real reservation.
                // It enters epoch 2 and cannot become a member of the reserved v2.
                await service.ingest(INPUTS[5]);
                throw new SimulatedInterruption();
              }
              return events;
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        try { await new MeterProof(faultStore, this.now).adjust({ expected_version: 1 }); }
        catch (error) { if (!(error instanceof SimulatedInterruption)) throw error; interrupted = true; }
        const period = await service.view();
        checks = [check('Intentional interruption observed', interrupted, true), check('Durable reserved version', period.building?.version ?? null, 2),
          check('Reserved fence epoch', period.building?.fence_epoch ?? null, 1), check('Published snapshot count', period.snapshots.length, 1),
          check('Fence members exclude newest event', fencedIds, ['evt_001', 'evt_002', 'evt_003', 'evt_004', 'evt_005']),
          check('Newest event acceptance epoch', period.events.find((event) => event.event_id === 'evt_006')?.epoch ?? null, 2),
          check('Unpublished adjustment units', period.pending.units, 350), preserved('Original snapshot preserved', snapshot(before, 1), snapshot(period, 1))];
        detail = 'The local simulator deliberately interrupted execution after v2 reserved epoch 1. evt_006 was accepted into epoch 2. The durable build remains recoverable and no v2 snapshot has been published.';
        break;
      }
      case 'recover_adjust': {
        await new MeterProof(store, this.now).adjust({ expected_version: 1 });
        const period = await service.view();
        checks = [check('Recovered v2 units', snapshot(period, 2)?.units ?? null, 1050),
          check('v2 added event IDs', snapshot(period, 2)?.added_event_ids ?? [], ['evt_004', 'evt_005']),
          check('Newer event remains pending', period.pending.event_ids, ['evt_006']), check('Pending units', period.pending.units, 50),
          check('Build cleared', period.building === null, true), preserved('Original snapshot preserved', snapshot(before, 1), snapshot(period, 1))];
        detail = 'A fresh MeterProof instance recovered the same reserved operation from the ledger. v2 contains 1,050 units; the 50 units accepted beyond its fence remain pending.';
        break;
      }
      case 'final_adjust': {
        await service.adjust({ expected_version: 2 });
        const period = await service.view();
        checks = [check('v3 units', snapshot(period, 3)?.units ?? null, 1100), check('v3 added event IDs', snapshot(period, 3)?.added_event_ids ?? [], ['evt_006']),
          check('Pending units', period.pending.units, 0), check('Snapshot versions', period.snapshots.map((item) => String(item.version)), ['1', '2', '3']),
          preserved('Original snapshot preserved', snapshot(before, 1), snapshot(period, 1)), preserved('Recovered snapshot preserved', snapshot(before, 2), snapshot(period, 2))];
        detail = 'The next adjustment includes only the remaining event. v3 reaches 1,100 units while v1 and v2 retain their original contents.';
        break;
      }
      case 'payload_conflict': {
        let status: number | null = null;
        try { await service.ingest({ ...INPUTS[3], units: 150 }); }
        catch (error) { if (!(error instanceof ApiError) || error.status !== 409) throw error; status = error.status; }
        const period = await service.view();
        checks = [check('Changed payload status', status, 409), check('Ledger event count', period.events.length, 6),
          check('Original evt_004 units', period.events.find((event) => event.event_id === 'evt_004')?.units ?? null, 100),
          check('Metering state unchanged', isDeepStrictEqual(before, period), true), check('Final authoritative units', snapshot(period, 3)?.units ?? null, 1100)];
        detail = 'Reusing evt_004 with 150 units produced an idempotency mismatch (409). The original 100-unit event, all snapshots, and the projection remained unchanged.';
        break;
      }
      default: throw new Error('Unknown local scenario action.');
    }
    return { step: index + 1, title: action.title, detail, checks };
  }
}
