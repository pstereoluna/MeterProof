import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MeterProof, type UsageEvent } from '../../src/domain';
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
    assert.equal(snapshot.units + (await f.service.view()).pending.units, 80);
  } finally { await f.cleanup(); }
});
