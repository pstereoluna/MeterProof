import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { buildReplay, REPLAY_FILES, sanitizeExchange } from '../scripts/build-replay';
import { createApiHandler } from '../src/api';
import type { MeterProof } from '../src/domain';
import type { RecordedReplay, ReplayRequest } from '../src/replay';

const replay = JSON.parse(readFileSync('web/replay.json', 'utf8')) as RecordedReplay;
const rawExchange = (r: ReplayRequest) => ({ request: { method: r.method, path: r.path, body: r.body }, at: r.at,
  response: { status: r.status, body: JSON.stringify(r.response) } });
function sourceFixture() {
  const exchanges = replay.steps.flatMap(step => step.requests).map(rawExchange);
  const initial = { customer_id: 'ACME', period: '2026-09', phase: 'OPEN', rate_cents_per_unit: 1,
    epoch: 0, latest_version: 0, building: null, aggregate: { units: 0, amount_cents: 0, processed_events: 0, last_processed_at: null },
    snapshots: [], events: [], pending: { units: 0, amount_cents: 0, event_ids: [] } };
  return Object.fromEntries(REPLAY_FILES.map((name, i) => [name, i === 0 ? {
    request: { method: 'GET', path: '/api/period', body: null }, at: replay.recorded_at,
    response: { status: 200, body: JSON.stringify(initial) },
  } : exchanges[i - 1]]));
}

test('recording preserves derivations and distinguishes unobserved processing state', () => {
  assert.deepEqual(replay.steps.map(s => s.id), ['accept', 'close', 'late', 'retry', 'adjust', 'verify']);
  assert.ok(replay.steps.flatMap(s => s.checks).every(c => c.passed));
  assert.deepEqual(replay.steps.filter(s => s.view_basis === 'reconstructed').map(s => s.id), ['accept', 'close', 'retry']);
  for (const step of replay.steps) {
    if (step.view_basis === 'reconstructed') assert.equal(step.period.aggregate, null);
    else assert.ok(step.period.aggregate);
    const byId = new Map(step.period.events.map(e => [e.event_id, e]));
    for (const snapshot of step.period.snapshots) {
      assert.equal(snapshot.units, snapshot.event_ids.reduce((sum, id) => sum + byId.get(id)!.units, 0));
      assert.equal(snapshot.amount_cents, snapshot.units);
    }
  }
  const original = replay.steps[1].period.snapshots[0];
  for (const step of replay.steps.slice(2)) assert.deepEqual(step.period.snapshots[0], original);
  assert.deepEqual(replay.steps.at(-1)!.period.snapshots.map(s => s.units), [750, 850]);
  assert.ok(replay.steps[0].period.events.every(e => e.processed_at === null));
});

test('exporter strips private headers and unknown nested fields', () => {
  const sample: any = structuredClone(rawExchange(replay.steps[0].requests[0]));
  sample.secret = 'PRIVATE_MARKER';
  sample.request.headers = { authorization: 'PRIVATE_MARKER' };
  sample.request.body.account = 'PRIVATE_MARKER';
  sample.response.headers = { 'x-amzn-requestid': 'PRIVATE_MARKER' };
  const body = JSON.parse(sample.response.body);
  body.event.private_path = 'PRIVATE_MARKER'; body.credentials = 'PRIVATE_MARKER';
  sample.response.body = JSON.stringify(body);
  const cleaned = sanitizeExchange(sample);
  assert.equal(JSON.stringify(cleaned).includes('PRIVATE_MARKER'), false);
  assert.deepEqual(Object.keys(cleaned), ['method', 'path', 'body', 'status', 'response', 'at']);
  const period: any = rawExchange(replay.steps.at(-1)!.requests[0]);
  const p = JSON.parse(period.response.body);
  p.snapshots[0].private = 'PRIVATE_MARKER'; p.aggregate.private = 'PRIVATE_MARKER'; p.pending.private = 'PRIVATE_MARKER';
  period.response.body = JSON.stringify(p);
  assert.equal(JSON.stringify(sanitizeExchange(period)).includes('PRIVATE_MARKER'), false);
  assert.throws(() => sanitizeExchange({ ...sample, request: { ...sample.request, path: 'https://private.example/api/events' } }));
});

test('recorded checks fail when responses conflict with expected behavior', () => {
  const raw = sourceFixture();
  assert.deepEqual(buildReplay(raw), replay);
  const response = raw['07-duplicate'].response;
  response.body = JSON.stringify({ ...JSON.parse(response.body), duplicate: false });
  const changed = buildReplay(raw);
  assert.equal(changed.steps.find(s => s.id === 'retry')!.checks.find(c => c.label === 'Duplicate flagged')!.passed, false);
});

test('read-only replay route works without touching a metering service', async () => {
  const service = new Proxy({}, { get() { throw new Error('Replay must not access the service'); } }) as MeterProof;
  const handler = createApiHandler(service, resolve('web/index.html'));
  const call = (method: string) => handler({ rawPath: '/api/replay', requestContext: { http: { method } } } as never);
  const result = await call('GET');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body!), replay);
  assert.equal((await call('POST')).statusCode, 404);
});
