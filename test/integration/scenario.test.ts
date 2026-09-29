import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MeterProof, PARTITION } from '../../src/domain.js';
import { DynamoStore } from '../../src/store.js';
import { LocalScenarioController, type ScenarioState } from '../../scripts/scenario.js';
import { ensureTables, localClient } from '../../scripts/local-db.js';

async function fixture() {
  const suffix = randomUUID().replace(/-/g, '');
  const names = [`MeterProofScenarioTestLedger${suffix}`, `MeterProofScenarioTestState${suffix}`];
  await ensureTables(names);
  const client = DynamoDBDocumentClient.from(localClient, { marshallOptions: { removeUndefinedValues: true } });
  const sender = { send(command: any) {
    if (command instanceof QueryCommand) command.input.Limit = 2;
    return client.send(command);
  } } as unknown as DynamoDBDocumentClient;
  const createStore = (runId: string) => new DynamoStore(sender, names[0], names[1], `DEMO#${runId}#${PARTITION}`);
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 1, 0, 0, tick++)).toISOString();
  const base = new MeterProof(new DynamoStore(sender, names[0], names[1]), now);
  return { createStore, now, base, async cleanup() {
    // Only these randomly named local test tables are removed, never demo tables.
    for (const TableName of names) await localClient.send(new DeleteTableCommand({ TableName }));
  } };
}

test('DynamoDB Local: all eight scenario actions verify lag, duplicate delivery, durable recovery, and preserved snapshots', async () => {
  const f = await fixture();
  try {
    await f.base.ingest({ event_id: 'original_saved_demo', units: 999, occurred_at: '2026-09-01T00:00:00Z' });
    const baseBefore = await f.base.view();
    let saved: ScenarioState | undefined;
    const options = { createStore: f.createStore, now: f.now, persist: async (state: ScenarioState) => { saved = structuredClone(state); } };
    let controller = new LocalScenarioController(options);
    assert.equal(await controller.view(), null);
    let view = await controller.start();
    assert.equal(view.step, 0);
    const runId = view.run_id;
    assert.equal(view.next_action?.id, 'seed_lag');
    view = await controller.advance({ run_id: runId, expected_step: 0 });
    assert.equal(view.period.events.reduce((sum, event) => sum + event.units, 0), 750);
    assert.equal(view.period.aggregate.units, 350);
    assert.equal(view.period.events.find((event) => event.event_id === 'evt_003')?.processed_at, null);
    view = await controller.advance({ run_id: runId, expected_step: 1 });
    const original = structuredClone(view.period.snapshots[0]);
    assert.equal(original.units, 750);
    assert.equal(view.period.aggregate.units, 350);
    view = await controller.advance({ run_id: runId, expected_step: 2 });
    assert.equal(view.period.aggregate.units, 750);
    assert.equal(view.period.aggregate.processed_events, 3);
    assert.equal(view.period.pending.units, 0);
    assert.equal(view.period.events.length, 3);
    view = await controller.advance({ run_id: runId, expected_step: 3 });
    assert.equal(view.period.pending.units, 300);
    assert.deepEqual(view.period.pending.event_ids, ['evt_004', 'evt_005']);
    view = await controller.advance({ run_id: runId, expected_step: 4 });
    const reserved = structuredClone(view.period.building);
    assert.equal(reserved?.version, 2);
    assert.equal(reserved?.fence_epoch, 1);
    assert.equal(view.period.snapshots.length, 1);
    assert.equal(view.period.pending.units, 350);
    assert.equal(view.period.events.find((event) => event.event_id === 'evt_006')?.epoch, 2);
    assert.equal(saved?.step, 5);
    // Resume from a serialized checkpoint and durable DynamoDB build after a process restart.
    controller = new LocalScenarioController({ ...options, initialState: JSON.parse(JSON.stringify(saved)) });
    assert.deepEqual((await controller.view())?.period.building, reserved);
    const stale = await controller.advance({ run_id: runId, expected_step: 4 });
    assert.equal(stale.step, 5);
    assert.equal(stale.period.snapshots.length, 1, 'retrying the interruption step must not recover or publish v2');
    view = await controller.advance({ run_id: runId, expected_step: 5 });
    assert.equal(view.period.snapshots[1].units, 1050);
    assert.equal(view.period.snapshots[1].created_at, reserved?.started_at);
    assert.deepEqual(view.period.snapshots[1].added_event_ids, ['evt_004', 'evt_005']);
    assert.equal(view.period.pending.units, 50);
    assert.deepEqual(view.period.pending.event_ids, ['evt_006']);
    const recovered = structuredClone(view.period.snapshots[1]);
    view = await controller.advance({ run_id: runId, expected_step: 6 });
    assert.equal(view.period.snapshots[2].units, 1100);
    assert.deepEqual(view.period.snapshots[2].added_event_ids, ['evt_006']);
    assert.equal(view.period.pending.units, 0);
    const beforeConflict = structuredClone(view.period);
    view = await controller.advance({ run_id: runId, expected_step: 7 });
    assert.deepEqual(view.period, beforeConflict);
    assert.equal(view.step, 8);
    assert.equal(view.total_steps, 8);
    assert.equal(view.next_action, null);
    assert.deepEqual(view.period.snapshots[0], original);
    assert.deepEqual(view.period.snapshots[1], recovered);
    assert.equal(view.history.length, 8);
    assert.ok(view.history.every((entry) => entry.checks.length > 0 && entry.checks.every((check) => check.passed)));
    assert.deepEqual(await controller.advance({ run_id: runId, expected_step: 0 }), view);
    assert.deepEqual(await controller.advance({ run_id: runId, expected_step: 8 }), view);
    assert.deepEqual(await f.base.view(), baseBefore, 'default partition remains untouched');
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: concurrent repeated steps serialize and new runs retain prior data', async () => {
  const f = await fixture();
  try {
    const controller = new LocalScenarioController({ createStore: f.createStore, now: f.now });
    const started = await controller.start();
    const results = await Promise.all(Array.from({ length: 4 }, () => controller.advance({ run_id: started.run_id, expected_step: 0 })));
    for (const result of results) {
      assert.equal(result.step, 1);
      assert.equal(result.history.length, 1);
      assert.equal(result.period.events.length, 3);
      assert.equal(result.period.aggregate.units, 350);
    }
    await assert.rejects(controller.advance({ run_id: started.run_id, expected_step: 2 }), { status: 409 });
    const oldStore = f.createStore(started.run_id);
    const before = await new MeterProof(oldStore, f.now).view();
    const fresh = await controller.start();
    assert.notEqual(fresh.run_id, started.run_id);
    assert.equal(fresh.step, 0);
    assert.equal(fresh.period.events.length, 0);
    assert.equal(fresh.period.aggregate.units, 0);
    await assert.rejects(controller.advance({ run_id: started.run_id, expected_step: 1 }), { status: 409 });
    await controller.advance({ run_id: fresh.run_id, expected_step: 0 });
    assert.deepEqual(await new MeterProof(oldStore, f.now).view(), before, 'starting another run never deletes or changes the previous run');
  } finally { await f.cleanup(); }
});

test('DynamoDB Local: an interruption with failed checkpoint safely repeats without publishing v2', async () => {
  const f = await fixture();
  try {
    let saved: ScenarioState | undefined;
    let failStepFive = true;
    const options = { createStore: f.createStore, now: f.now, persist: async (next: ScenarioState) => {
      if (next.step === 5 && failStepFive) { failStepFive = false; throw new Error('simulated local checkpoint write failure'); }
      saved = structuredClone(next);
    } };
    let controller = new LocalScenarioController(options);
    const started = await controller.start();
    for (let step = 0; step < 4; step++) await controller.advance({ run_id: started.run_id, expected_step: step });
    await assert.rejects(controller.advance({ run_id: started.run_id, expected_step: 4 }), /checkpoint write failure/);
    assert.equal(saved?.step, 4);
    const afterFailure = await new MeterProof(f.createStore(started.run_id), f.now).view();
    assert.equal(afterFailure.building?.version, 2);
    assert.equal(afterFailure.snapshots.length, 1);
    assert.equal(afterFailure.events.length, 6);
    controller = new LocalScenarioController({ ...options, initialState: structuredClone(saved) });
    const retry = await controller.advance({ run_id: started.run_id, expected_step: 4 });
    assert.equal(retry.step, 5);
    assert.equal(retry.period.snapshots.length, 1);
    assert.equal(retry.period.events.length, 6);
    assert.deepEqual(retry.period.building, afterFailure.building);
    const recovered = await controller.advance({ run_id: started.run_id, expected_step: 5 });
    assert.equal(recovered.period.snapshots[1].units, 1050);
    assert.equal(recovered.period.pending.units, 50);
  } finally { await f.cleanup(); }
});
