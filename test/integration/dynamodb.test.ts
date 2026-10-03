import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MeterProof, type UsageEvent } from '../../src/domain';
import { createApiHandler } from '../../src/api';
import { quantityInteger } from '../../src/quantity';
import { DynamoStore } from '../../src/store';
import { ensureTables, localClient } from '../../scripts/local-db';

const event = (event_id: string, units = 100) => ({ event_id, units, occurred_at: '2026-09-29T23:58:00Z' });

async function fixture() {
  const suffix = randomUUID().replace(/-/g, '');
  const names = [`MeterProofTestLedger${suffix}`, `MeterProofTestState${suffix}`];
  await ensureTables(names);
  const client = DynamoDBDocumentClient.from(localClient, { marshallOptions: { removeUndefinedValues: true } });
  // Force pagination on real DynamoDB queries, even for the four-event demo.
  const sender = { send(command: any) {
    if (command instanceof QueryCommand) command.input.Limit = 2;
    return client.send(command);
  } } as unknown as DynamoDBDocumentClient;
  const store = new DynamoStore(sender, names[0], names[1]);
  const service = new MeterProof(store);
  return { store, service, async cleanup() {
    for (const TableName of names) await localClient.send(new DeleteTableCommand({ TableName }));
  } };
}

test('DynamoDB Local: complete frozen demo survives lag, duplicates, and pagination', async () => {
  const f = await fixture();
  try {
    for (const [id, units] of [['evt_001', 100], ['evt_002', 250], ['evt_003', 400]] as const) await f.service.ingest(event(id, units));
    assert.equal((await f.service.view()).aggregate.units, 0);
    const v1 = await f.service.close();
    assert.equal(v1.amount_cents, 750, 'close reads ledger before any metering');
    assert.deepEqual(await f.service.close(), v1);
    const late = await f.service.ingest(event('evt_004'));
    assert.equal(late.event.classification, 'POST_CLOSE');
    assert.equal((await f.service.ingest(event('evt_001'))).duplicate, true);
    await assert.rejects(f.service.ingest(event('evt_001', 101)), { status: 409 });
    assert.equal((await f.service.view()).pending.amount_cents, 100);
    for (const item of await f.store.queryEvents()) {
      assert.equal(await f.store.processEvent(item, '2026-10-01T00:03:00.000Z'), true);
      assert.equal(await f.store.processEvent(item, '2026-10-01T00:04:00.000Z'), false);
    }
    assert.equal((await f.service.view()).aggregate.units, 750);
    const v2 = await f.service.adjust({ expected_version: 1 });
    assert.equal(v2.amount_cents, 850);
    assert.deepEqual(v2.added_event_ids, ['evt_004']);
    assert.deepEqual(await f.service.adjust({ expected_version: 1 }), v2);
    const final = await f.service.view();
    assert.deepEqual(final.snapshots[0], v1);
    assert.equal(final.snapshots.length, 2);
    assert.equal(final.pending.units, 0);
    assert.equal(final.events.length, 4);
    assert.ok(final.events.every(item => item.processed_at === '2026-10-01T00:03:00.000Z'));
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: close wins after ingest read; the transaction retries as POST_CLOSE', async () => {
  const f = await fixture();
  try {
    const accept = f.store.acceptEvent.bind(f.store);
    let inject = true;
    f.store.acceptEvent = async (...args) => {
      if (inject) { inject = false; await f.service.close(); }
      return accept(...args);
    };
    const accepted = await f.service.ingest(event('raced'));
    assert.equal(accepted.event.classification, 'POST_CLOSE');
    assert.equal((await f.service.close()).units, 0);
    assert.equal((await f.service.view()).pending.units, 100);
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: a crashed fenced build resumes; later usage stays pending', async () => {
  const f = await fixture();
  try {
    await f.service.ingest(event('before', 750));
    const query = f.store.queryEvents.bind(f.store);
    let crash = true;
    f.store.queryEvents = async (epoch) => {
      if (crash && epoch !== undefined) { crash = false; throw new Error('simulated process death after fence'); }
      return query(epoch);
    };
    await assert.rejects(f.service.close(), /simulated process death/);
    const late = await f.service.ingest(event('after', 100));
    assert.equal(late.event.classification, 'POST_CLOSE');
    assert.equal((await new MeterProof(f.store).close()).units, 750);
    let fenceInjection = true;
    f.store.queryEvents = async (epoch) => {
      if (fenceInjection && epoch === 1) {
        fenceInjection = false;
        await f.service.ingest(event('after-adjust-fence', 50));
      }
      return query(epoch);
    };
    const v2 = await f.service.adjust({ expected_version: 1 });
    assert.equal(v2.units, 850);
    assert.equal((await f.service.view()).pending.units, 50);
    const v3 = await f.service.adjust({ expected_version: 2 });
    assert.equal(v3.units, 900);
    assert.deepEqual(v3.added_event_ids, ['after-adjust-fence']);
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: duplicate processors racing commit only one receipt and increment', async () => {
  const f = await fixture();
  try {
    const { event: item } = await f.service.ingest(event('duplicate', 250));
    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => f.store.processEvent(item, new Date().toISOString())));
    // A transient transaction conflict is retryable; replaying must still converge.
    for (const result of settled) if (result.status === 'rejected') await f.store.processEvent(item, new Date().toISOString());
    assert.equal((await f.service.view()).aggregate.units, 250);
    assert.equal((await f.service.view()).aggregate.processed_events, 1);
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: concurrent ingest and close exactly partition accepted events', async () => {
  const f = await fixture();
  try {
    await f.service.view();
    const results = await Promise.allSettled([
      ...Array.from({ length: 8 }, (_, i) => f.service.ingest(event(`race_${i}`, 10))),
      f.service.close(),
    ]);
    // Retry failed requests with the same IDs, as a client would on 503/conflict.
    for (let i = 0; i < 8; i++) if (results[i].status === 'rejected') await f.service.ingest(event(`race_${i}`, 10));
    const snapshot = await f.service.close();
    const all = await f.store.queryEvents();
    const onTime = all.filter((item: UsageEvent) => item.classification === 'ON_TIME');
    assert.deepEqual([...snapshot.event_ids].sort(), onTime.map(item => item.event_id).sort());
    assert.equal(all.length, 8);
    assert.equal(quantityInteger(snapshot.units) + quantityInteger((await f.service.view()).pending.units), 80n);
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: large totals survive exact ADD, redelivery, snapshot storage and API JSON', async () => {
  const f = await fixture();
  try {
    for (const [id, units] of [['large', Number.MAX_SAFE_INTEGER], ['small_a', 1], ['small_b', 1]] as const) {
      const { event: item } = await f.service.ingest(event(id, units));
      assert.equal(await f.store.processEvent(item, '2026-10-01T00:01:00Z'), true);
      assert.equal(await f.store.processEvent(item, '2026-10-01T00:02:00Z'), false);
    }
    const raw = await f.store.client.send(new QueryCommand({
      TableName: f.store.stateTable,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: { ':pk': f.store.partition, ':sk': 'AGGREGATE' },
      ConsistentRead: true,
    }));
    assert.equal(raw.Items?.[0].units, 9007199254740993n, 'real SDK decoding must preserve the DynamoDB numeric ADD');
    const closed = await f.service.close();
    assert.equal(closed.units, '9007199254740993');
    assert.deepEqual(await f.store.getSnapshot(1), closed, 'large snapshot totals round-trip through storage');
    const handler = createApiHandler(f.service);
    const response = await handler({ rawPath: '/api/period', requestContext: { http: { method: 'GET' } } } as any);
    assert.equal(response.statusCode, 200, 'SDK bigint must not leak into JSON.stringify');
    const view = JSON.parse(response.body!);
    assert.equal(view.aggregate.units, '9007199254740993');
    assert.equal(view.aggregate.amount_cents, '9007199254740993');
    assert.equal(view.aggregate.processed_events, 3);
    assert.equal(view.snapshots[0].amount_cents, '9007199254740993');
    assert.equal(view.pending.units, 0);
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: a previously reserved overflowing close recovers its original fence', async () => {
  const f = await fixture();
  try {
    await f.service.ingest(event('large', Number.MAX_SAFE_INTEGER));
    await f.service.ingest(event('small', 2));
    const period = await f.store.getPeriod();
    // Persist the same build shape left behind by the old 422 overflow path.
    const build = { version: 1, base_version: 0, kind: 'CLOSE' as const, fence_epoch: period.epoch,
      started_at: '2026-10-01T00:00:00Z', operation_id: randomUUID() };
    assert.equal(await f.store.reserveBuild(period, build), true);
    await f.service.ingest(event('after_fence', 5));
    const recovered = await new MeterProof(f.store).close();
    assert.equal(recovered.units, '9007199254740993');
    assert.equal(recovered.through_epoch, build.fence_epoch);
    assert.equal(recovered.created_at, build.started_at);
    assert.deepEqual(recovered.event_ids, ['large', 'small']);
    assert.deepEqual(await f.service.close(), recovered);
    assert.equal((await f.store.getPeriod()).building, undefined);
    assert.deepEqual((await f.service.view()).pending.event_ids, ['after_fence']);
    assert.equal((await f.service.view()).pending.units, 5);
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: a previously reserved overflowing adjustment preserves prior snapshots and later arrivals', async () => {
  const f = await fixture();
  try {
    await f.service.ingest(event('base', 750));
    const original = await f.service.close();
    await f.service.ingest(event('late_large', Number.MAX_SAFE_INTEGER));
    await f.service.ingest(event('late_small', 2));
    assert.equal((await f.service.view()).pending.units, '9007199254740993');
    const period = await f.store.getPeriod();
    const build = { version: 2, base_version: 1, kind: 'ADJUST' as const, fence_epoch: period.epoch,
      started_at: '2026-10-01T00:01:00Z', operation_id: randomUUID() };
    assert.equal(await f.store.reserveBuild(period, build), true);
    await f.service.ingest(event('after_fence', 5));
    const recovered = await new MeterProof(f.store).adjust({ expected_version: 1 });
    assert.equal(recovered.units, '9007199254741743');
    assert.equal(recovered.amount_cents, '9007199254741743');
    assert.equal(recovered.through_epoch, build.fence_epoch);
    assert.equal(recovered.created_at, build.started_at);
    assert.deepEqual(recovered.added_event_ids, ['late_large', 'late_small']);
    assert.deepEqual(await f.service.adjust({ expected_version: 1 }), recovered);
    assert.deepEqual(await f.service.close(), original);
    assert.equal((await f.store.getPeriod()).building, undefined);
    assert.deepEqual((await f.service.view()).pending.event_ids, ['after_fence']);
    const next = await f.service.adjust({ expected_version: 2 });
    assert.equal(next.units, '9007199254741748');
    assert.deepEqual((await f.service.view()).snapshots.slice(0, 2), [original, recovered]);
    assert.equal((await f.service.view()).pending.units, 0);
  } finally { await f.cleanup(); }
});
