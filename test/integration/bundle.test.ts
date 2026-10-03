import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { ensureTables, localClient, localEndpoint } from '../../scripts/local-db';

test('synthesized Lambda bundles serve the UI and complete the real local transaction path', async () => {
  const assets = JSON.parse(readFileSync('cdk.out/MeterProof.assets.json', 'utf8'));
  const asset = (name: string) => {
    const file = Object.values(assets.files).find((item: any) => item.displayName === name) as { source: { path: string } };
    assert.ok(file, `Missing ${name}; run npm run synth before the integration tests.`);
    return resolve('cdk.out', file.source.path, 'index.js');
  };
  const suffix = randomUUID().replace(/-/g, '');
  const names = [`MeterProofBundleLedger${suffix}`, `MeterProofBundleState${suffix}`];
  await ensureTables(names);
  process.env.DYNAMODB_ENDPOINT = localEndpoint;
  process.env.LEDGER_TABLE = names[0];
  process.env.STATE_TABLE = names[1];
  const api = require(asset('ApiFunction/Code')).handler;
  const meter = require(asset('MeterFunction/Code')).handler;
  const call = (method: string, path: string, body?: unknown) => api({
    version: '2.0', rawPath: path, requestContext: { http: { method } },
    body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false,
  });
  try {
    const html = await call('GET', '/');
    assert.equal(html.statusCode, 200);
    assert.match(html.body, /MeterProof/);
    const health = await call('GET', '/api/health');
    assert.equal(JSON.parse(health.body).mode, 'local');
    assert.notEqual(JSON.parse(health.body).demo, true, 'deployed handler never enables local scenario controls');
    const replay = await call('GET', '/api/replay');
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(JSON.parse(replay.body), JSON.parse(readFileSync('web/replay.json', 'utf8')));
    assert.equal((await call('POST', '/api/replay', {})).statusCode, 404);
    assert.equal(JSON.parse((await call('GET', '/api/period')).body).events.length, 0, 'reading the recording does not seed the ledger');
    assert.equal((await call('GET', '/api/demo')).statusCode, 404);
    assert.equal((await call('POST', '/api/demo/start', {})).statusCode, 404);
    assert.equal((await call('POST', '/api/demo/step', { run_id: 'local-only', expected_step: 0 })).statusCode, 404);
    const originalEvent = { event_id: 'bundled', occurred_at: '2026-09-20T12:00:00Z', units: 750 };
    const accepted = await call('POST', '/api/events', originalEvent);
    assert.equal(accepted.statusCode, 201);
    assert.equal((await call('POST', '/api/events', originalEvent)).statusCode, 200);
    assert.equal((await call('POST', '/api/events', { ...originalEvent, units: 1 })).statusCode, 409);
    assert.equal(JSON.parse((await call('POST', '/api/close', {})).body).snapshot.amount_cents, 750);
    const event = JSON.parse(accepted.body).event;
    const stream = { Records: [{ eventName: 'INSERT', eventID: 'bundle-record', dynamodb: {
      SequenceNumber: '1', NewImage: marshall({ entity: 'EVENT', event }),
    } }] };
    assert.deepEqual(await meter(stream), { batchItemFailures: [] });
    assert.deepEqual(await meter(stream), { batchItemFailures: [] });
    assert.equal((await call('POST', '/api/events', { ...originalEvent, event_id: 'late', units: 100 })).statusCode, 201);
    const adjusted = JSON.parse((await call('POST', '/api/adjust', { expected_version: 1 })).body).snapshot;
    assert.equal(adjusted.amount_cents, 850);
    const final = JSON.parse((await call('GET', '/api/period')).body);
    assert.equal(final.aggregate.units, 750);
    assert.deepEqual(final.snapshots.map((item: any) => item.amount_cents), [750, 850]);

    // The actual Lambda bundle must also serialize large totals and preserve older versions.
    for (const [event_id, units] of [['late_large', Number.MAX_SAFE_INTEGER], ['late_small', 2]] as const) {
      assert.equal((await call('POST', '/api/events', { ...originalEvent, event_id, units })).statusCode, 201);
    }
    const pending = await call('GET', '/api/period');
    assert.equal(pending.statusCode, 200);
    assert.equal(JSON.parse(pending.body).pending.amount_cents, '9007199254740993');
    const largeAdjustment = await call('POST', '/api/adjust', { expected_version: 2 });
    assert.equal(largeAdjustment.statusCode, 200);
    assert.equal(JSON.parse(largeAdjustment.body).snapshot.amount_cents, '9007199254741843');
    const afterLarge = JSON.parse((await call('GET', '/api/period')).body);
    assert.deepEqual(afterLarge.snapshots.slice(0, 2), final.snapshots);
    assert.equal(afterLarge.building, null);
    assert.equal(afterLarge.pending.units, 0);
  } finally {
    for (const TableName of names) await localClient.send(new DeleteTableCommand({ TableName }));
  }
});
