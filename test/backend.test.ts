import assert from 'node:assert/strict';
import test from 'node:test';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import {
  ApiError, MeterProof, emptyAggregate,
  type Build, type ExistingEvent, type PeriodState, type Snapshot,
  type StateContents, type Store, type UsageEvent,
} from '../src/domain.js';
import { createMeterHandler } from '../src/meter.js';
import { createRuntime } from '../src/runtime.js';

const clone = <T>(value: T): T => structuredClone(value);
class MemoryStore implements Store {
  period: PeriodState = { phase: 'OPEN', epoch: 0, latest_version: 0 };
  events = new Map<string, ExistingEvent>();
  snapshots = new Map<number, Snapshot>();
  receipts = new Map<string, { event_id: string; processed_at: string }>();
  aggregate = emptyAggregate();
  beforeAccept?: () => Promise<void>;
  beforeQuery?: (throughEpoch?: number) => Promise<void>;
  failPublishOnce = false;
  async ensurePeriod() {}
  async getPeriod() { return clone(this.period); }
  async findEvent(eventId: string) { const event = this.events.get(eventId); return event ? clone(event) : undefined; }
  async acceptEvent(event: UsageEvent, fingerprint: string, expected: PeriodState) {
    if (this.beforeAccept) { const hook = this.beforeAccept; this.beforeAccept = undefined; await hook(); }
    if (this.period.epoch !== expected.epoch || this.period.phase !== expected.phase || this.events.has(event.event_id)) return false;
    this.events.set(event.event_id, clone({ event, fingerprint }));
    return true;
  }
  async reserveBuild(expected: PeriodState, build: Build) {
    if (this.period.epoch !== expected.epoch || this.period.phase !== expected.phase || this.period.latest_version !== expected.latest_version || this.period.building) return false;
    this.period = { ...this.period, phase: 'CLOSED', epoch: expected.epoch + 1, building: clone(build) };
    return true;
  }
  async queryEvents(throughEpoch?: number) {
    if (this.beforeQuery) { const hook = this.beforeQuery; this.beforeQuery = undefined; await hook(throughEpoch); }
    return [...this.events.values()].map(({ event }) => clone(event))
      .filter((event) => throughEpoch === undefined || event.epoch <= throughEpoch)
      .sort((a, b) => a.epoch - b.epoch || a.event_id.localeCompare(b.event_id));
  }
  async getSnapshot(version: number) { const snapshot = this.snapshots.get(version); return snapshot ? clone(snapshot) : undefined; }
  async publishSnapshot(build: Build, snapshot: Snapshot) {
    if (this.failPublishOnce) { this.failPublishOnce = false; throw new Error('Simulated process termination before publish'); }
    if (this.period.building?.operation_id !== build.operation_id || this.period.latest_version !== build.base_version || this.snapshots.has(build.version)) return false;
    this.snapshots.set(build.version, clone(snapshot));
    delete this.period.building;
    this.period.latest_version = build.version;
    return true;
  }
  async stateContents(): Promise<StateContents> {
    return clone({ snapshots: [...this.snapshots.values()], receipts: [...this.receipts.values()], aggregate: this.aggregate });
  }
  async processEvent(event: UsageEvent, processedAt: string) {
    if (this.receipts.has(event.event_id)) return false;
    this.receipts.set(event.event_id, { event_id: event.event_id, processed_at: processedAt });
    if (event.classification === 'ON_TIME') {
      this.aggregate.units += event.units;
      this.aggregate.amount_cents += event.amount_cents;
      this.aggregate.processed_events++;
      this.aggregate.last_processed_at = processedAt;
    }
    return true;
  }
}
const input = (event_id = 'evt_001', units = 250) => ({ event_id, occurred_at: '2026-09-15T12:00:00Z', units });
const setup = () => {
  const store = new MemoryStore();
  let tick = 0;
  const service = new MeterProof(store, () => new Date(Date.UTC(2026, 9, 1, 0, 0, tick++)).toISOString());
  return { store, service };
};

test('frozen demo derives 750 → 850 cents from ledger and preserves original snapshot', async () => {
  const { store, service } = setup();
  await service.ingest(input('evt_001', 250));
  await service.ingest(input('evt_002', 300));
  await service.ingest(input('evt_003', 200));
  const original = await service.close();
  assert.equal(original.amount_cents, 750);
  assert.equal(store.aggregate.units, 0, 'close does not depend on the stream aggregate');
  const late = await service.ingest(input('evt_004', 100));
  assert.equal(late.event.classification, 'POST_CLOSE');
  assert.equal((await service.view()).pending.amount_cents, 100);
  const adjusted = await service.adjust({ expected_version: 1 });
  assert.equal(adjusted.amount_cents, 850);
  assert.deepEqual(adjusted.added_event_ids, ['evt_004']);
  assert.deepEqual(await store.getSnapshot(1), original);
  assert.equal((await service.view()).pending.units, 0);
});

test('same event replay returns the original acceptance without another ledger write', async () => {
  const { store, service } = setup();
  const first = await service.ingest(input());
  await service.close();
  const replay = await service.ingest({ ...input(), occurred_at: '2026-09-15T12:00:00.000Z' });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.event, first.event);
  assert.equal(store.events.size, 1);
  await assert.rejects(service.ingest(input('evt_001', 251)), (error: unknown) => error instanceof ApiError && error.status === 409);
});

test('close winning the ingestion race forces retry into POST_CLOSE epoch', async () => {
  const { store, service } = setup();
  store.beforeAccept = async () => { await service.close(); };
  const accepted = await service.ingest(input());
  assert.equal(accepted.event.classification, 'POST_CLOSE');
  assert.equal(accepted.event.epoch, 1);
  assert.equal((await store.getSnapshot(1))?.units, 0);
});

test('accepted before close, processed afterward remains ON_TIME and included in v1', async () => {
  const { store, service } = setup();
  const { event } = await service.ingest(input());
  assert.equal((await service.close()).units, 250);
  assert.equal(await store.processEvent(event, '2026-10-01T03:00:00.000Z'), true);
  const view = await service.view();
  assert.equal(view.events[0]?.classification, 'ON_TIME');
  assert.equal(view.events[0]?.processed_at, '2026-10-01T03:00:00.000Z');
  assert.equal(view.aggregate.units, 250);
  assert.equal(view.pending.units, 0);
});

test('close fence excludes events arriving during authoritative ledger scan', async () => {
  const { store, service } = setup();
  await service.ingest(input('before', 750));
  store.beforeQuery = async (fence) => {
    assert.equal(fence, 0);
    await service.ingest(input('during_scan', 100));
  };
  assert.equal((await service.close()).units, 750);
  assert.deepEqual((await service.view()).pending.event_ids, ['during_scan']);
});

test('crash after close fence can recover without including subsequent events', async () => {
  const { store, service } = setup();
  await service.ingest(input('before', 750));
  store.failPublishOnce = true;
  await assert.rejects(service.close(), /Simulated/);
  const reserved = clone(store.period.building);
  await service.ingest(input('after_crash', 100));
  const recovered = await service.close();
  assert.equal(recovered.units, 750);
  assert.equal(recovered.created_at, reserved?.started_at);
  assert.equal(store.period.building, undefined);
  assert.equal((await service.close()).version, 1);
});

test('adjustment crash preserves its fence; newer arrivals remain pending for next adjustment', async () => {
  const { store, service } = setup();
  await service.ingest(input('before', 750));
  await service.close();
  await service.ingest(input('first_late', 100));
  store.failPublishOnce = true;
  await assert.rejects(service.adjust({ expected_version: 1 }), /Simulated/);
  await service.ingest(input('after_fence', 25));
  const recovered = await service.adjust({ expected_version: 1 });
  assert.equal(recovered.units, 850);
  assert.deepEqual(recovered.added_event_ids, ['first_late']);
  assert.deepEqual((await service.view()).pending.event_ids, ['after_fence']);
  const next = await service.adjust({ expected_version: 2 });
  assert.equal(next.units, 875);
  assert.deepEqual(await service.adjust({ expected_version: 1 }), recovered);
  assert.equal((await service.close()).version, 1, 'close retries never make an adjustment');
  assert.equal(store.snapshots.size, 3);
});

test('concurrent ingestion and snapshot retries create one event and one version', async () => {
  const { store, service } = setup();
  const ingested = await Promise.all([service.ingest(input()), service.ingest(input())]);
  assert.equal(ingested.filter((result) => !result.duplicate).length, 1);
  const closed = await Promise.all([service.close(), service.close()]);
  assert.deepEqual(closed[0], closed[1]);
  await service.ingest(input('late', 100));
  const adjusted = await Promise.all([service.adjust({ expected_version: 1 }), service.adjust({ expected_version: 1 })]);
  assert.deepEqual(adjusted[0], adjusted[1]);
  assert.equal(store.snapshots.size, 2);
});

test('replayed stream events apply aggregate once and POST_CLOSE only writes a receipt', async () => {
  const { store, service } = setup();
  const { event } = await service.ingest(input());
  const outcomes = await Promise.all([store.processEvent(event, '2026-10-01T01:00:00Z'), store.processEvent(event, '2026-10-01T02:00:00Z')]);
  assert.deepEqual(outcomes, [true, false]);
  await service.close();
  const late = await service.ingest(input('late', 100));
  await store.processEvent(late.event, '2026-10-01T03:00:00Z');
  assert.equal(store.aggregate.units, 250);
  assert.equal(store.aggregate.processed_events, 1);
  assert.equal(store.receipts.size, 2);
});

test('validation rejects invalid date, non-integral units, reserved fields, and wrong expected version', async () => {
  const { service } = setup();
  for (const invalid of [
    { ...input(), occurred_at: '2026-09-31T12:00:00Z' },
    { ...input(), occurred_at: '2026-10-01T00:00:00Z' },
    { ...input(), units: 0 }, { ...input(), units: 1.5 },
    { ...input(), accepted_at: '2026-01-01T00:00:00Z' },
  ]) await assert.rejects(service.ingest(invalid), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(service.adjust({ expected_version: 1 }), (error: unknown) => error instanceof ApiError && error.status === 409);
});

test('stream partial failures use sequence numbers and ignore idempotency ledger records', async () => {
  const { service } = setup();
  const { event } = await service.ingest(input());
  const attempted: string[] = [];
  const handler = createMeterHandler({
    processEvent: async (received) => {
      attempted.push(received.event_id);
      if (received.event_id === 'bad') throw new Error('Retryable write failure');
      return true;
    },
  });
  const records = [
    { entity: 'IDEMPOTENCY' },
    { entity: 'EVENT', event: { ...event, event_id: 'bad' } },
    { entity: 'EVENT', event: { ...event, event_id: 'good' } },
  ].map((item, index) => ({ eventID: `id-${index}`, eventName: 'INSERT', dynamodb: { SequenceNumber: `${100 + index}`, NewImage: marshall(item) } }));
  const result = await handler({ Records: records } as DynamoDBStreamEvent);
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: '101' }]);
  assert.deepEqual(attempted, ['bad', 'good']);
});

test('remote DynamoDB endpoints cannot enable development credentials', () => {
  assert.throws(() => createRuntime({ LEDGER_TABLE: 'ledger', STATE_TABLE: 'state', DYNAMODB_ENDPOINT: 'https://dynamodb.us-west-2.amazonaws.com' }), /loopback/);
});
