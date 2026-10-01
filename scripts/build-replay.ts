/** Offline allowlisted export of actual saved smoke exchanges. Never contacts AWS. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ReplayCheck, ReplayPeriod, ReplayRequest, RecordedReplay } from '../src/replay.js';
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a recorded JSON object.');
  return value as Record<string, any>;
};
const exact = (value: unknown, keys: string[]): Record<string, any> => {
  const source = object(value);
  return Object.fromEntries(keys.map(key => {
    if (!Object.hasOwn(source, key)) throw new Error(`Missing recorded field: ${key}`);
    return [key, source[key]];
  }));
};
const timestamp = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid recorded timestamp.');
  return value;
};
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid recorded integer.');
  return value;
};
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('Invalid recorded event ID.');
  return value;
};
const ids = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('Expected recorded event IDs.');
  return value.map(id);
};
const member = <T extends string>(value: unknown, allowed: T[]): T => {
  if (!allowed.includes(value as T)) throw new Error('Unexpected recorded enum value.');
  return value as T;
};
function cleanEvent(value: unknown, processing: boolean) {
  const r = exact(value, ['event_id', 'occurred_at', 'accepted_at', 'units', 'amount_cents', 'classification', 'epoch']);
  r.event_id = id(r.event_id);
  for (const key of ['occurred_at', 'accepted_at']) r[key] = timestamp(r[key]);
  for (const key of ['units', 'amount_cents', 'epoch']) r[key] = integer(r[key]);
  r.classification = member(r.classification, ['ON_TIME', 'POST_CLOSE']);
  if (processing) r.processed_at = object(value).processed_at === null ? null : timestamp(object(value).processed_at);
  return r;
}
function cleanSnapshot(value: unknown) {
  const r = exact(value, ['version', 'kind', 'units', 'amount_cents', 'event_ids', 'added_event_ids', 'created_at', 'through_epoch']);
  for (const key of ['version', 'units', 'amount_cents', 'through_epoch']) r[key] = integer(r[key]);
  r.kind = member(r.kind, ['CLOSE', 'ADJUST']);
  r.event_ids = ids(r.event_ids); r.added_event_ids = ids(r.added_event_ids); r.created_at = timestamp(r.created_at);
  return r;
}
function cleanPeriod(value: unknown): ReplayPeriod {
  const r = exact(value, ['customer_id', 'period', 'phase', 'rate_cents_per_unit', 'epoch', 'latest_version', 'building', 'aggregate', 'snapshots', 'events', 'pending']);
  r.customer_id = member(r.customer_id, ['ACME']); r.period = member(r.period, ['2026-09']); r.phase = member(r.phase, ['OPEN', 'CLOSED']);
  for (const key of ['rate_cents_per_unit', 'epoch', 'latest_version']) r[key] = integer(r[key]);
  if (r.building !== null) {
    r.building = exact(r.building, ['version', 'kind', 'fence_epoch', 'started_at']);
    for (const key of ['version', 'fence_epoch']) r.building[key] = integer(r.building[key]);
    r.building.kind = member(r.building.kind, ['CLOSE', 'ADJUST']); r.building.started_at = timestamp(r.building.started_at);
  }
  r.aggregate = exact(r.aggregate, ['units', 'amount_cents', 'processed_events', 'last_processed_at']);
  for (const key of ['units', 'amount_cents', 'processed_events']) r.aggregate[key] = integer(r.aggregate[key]);
  if (r.aggregate.last_processed_at !== null) r.aggregate.last_processed_at = timestamp(r.aggregate.last_processed_at);
  if (!Array.isArray(r.snapshots) || !Array.isArray(r.events)) throw new Error('Missing recorded snapshot/event arrays.');
  r.snapshots = r.snapshots.map(cleanSnapshot); r.events = r.events.map((event: unknown) => cleanEvent(event, true));
  r.pending = exact(r.pending, ['units', 'amount_cents', 'event_ids']);
  r.pending.units = integer(r.pending.units); r.pending.amount_cents = integer(r.pending.amount_cents); r.pending.event_ids = ids(r.pending.event_ids);
  return r as ReplayPeriod;
}
/** Select every public field explicitly, including nested response objects. */
export function sanitizeExchange(value: unknown): ReplayRequest {
  const source = object(value), request = object(source.request), response = object(source.response);
  const method = member(request.method, ['GET', 'POST'] as const as ('GET' | 'POST')[]);
  const path = member(request.path, ['/api/events', '/api/close', '/api/adjust', '/api/period']);
  if ((path === '/api/period') !== (method === 'GET')) throw new Error('Unexpected recorded method/path combination.');
  let body: Record<string, unknown> | null = null;
  if (path === '/api/events') {
    body = exact(request.body, ['event_id', 'occurred_at', 'units']);
    body.event_id = id(body.event_id); body.occurred_at = timestamp(body.occurred_at); body.units = integer(body.units);
  } else if (path === '/api/adjust') body = { expected_version: integer(object(request.body).expected_version) };
  else if (path === '/api/close') { object(request.body); body = {}; }
  else if (request.body !== null) throw new Error('GET observation should have a null request body.');
  const status = integer(response.status);
  if (![200, 201, 409].includes(status)) throw new Error('Unexpected smoke response status.');
  if (typeof response.body !== 'string') throw new Error('Expected a saved raw response body.');
  const parsed = object(JSON.parse(response.body));
  let publicResponse: Record<string, any>;
  if (status === 409) publicResponse = {
    error: member(parsed.error, ['IDEMPOTENCY_MISMATCH']),
    message: member(parsed.message, ['event_id already exists with a different payload.']),
  };
  else if (path === '/api/events') {
    if (typeof parsed.duplicate !== 'boolean') throw new Error('Missing recorded duplicate flag.');
    publicResponse = { event: cleanEvent(parsed.event, false), duplicate: parsed.duplicate };
  } else if (path === '/api/period') publicResponse = cleanPeriod(parsed);
  else publicResponse = { snapshot: cleanSnapshot(parsed.snapshot) };
  return { method, path, body, status, response: publicResponse, at: timestamp(source.at) };
}
export const REPLAY_FILES = [
  '02-before', '03-seed-1', '03-seed-2', '03-seed-3', '04-close-v1', '05-late', '06-pending',
  '07-duplicate', '08-conflict', '09-close-retry', '10-adjust-v2', '11-adjust-retry', '12-close-after-adjust', '13-adjusted', '14-receipts-1',
] as const;
const check = (label: string, actual: unknown, expected: unknown): ReplayCheck => ({ label, actual, expected, passed: isDeepStrictEqual(actual, expected) });
export function buildReplay(raw: Record<string, unknown>): RecordedReplay {
  const records = Object.fromEntries(REPLAY_FILES.map(name => [name, sanitizeExchange(raw[name])]));
  const get = (name: typeof REPLAY_FILES[number]) => records[name]!;
  const seeds = ['03-seed-1', '03-seed-2', '03-seed-3'].map(name => records[name]!);
  const acceptedEvents = seeds.map(exchange => ({ ...exchange.response.event, processed_at: null }));
  const acceptedIds = acceptedEvents.map(event => event.event_id);
  const initial = structuredClone(get('02-before').response) as ReplayPeriod;
  const accepted: ReplayPeriod = { ...initial, events: acceptedEvents as ReplayPeriod['events'], aggregate: null };
  const close = get('04-close-v1'), v1 = close.response.snapshot;
  const closed: ReplayPeriod = { ...structuredClone(accepted), phase: 'CLOSED', epoch: v1.through_epoch + 1, latest_version: v1.version, snapshots: [structuredClone(v1)], aggregate: null };
  const late = get('05-late'), pending = get('06-pending').response as ReplayPeriod;
  const duplicate = get('07-duplicate'), conflict = get('08-conflict'), closeRetry = get('09-close-retry');
  const retry: ReplayPeriod = { ...structuredClone(pending), aggregate: null };
  const adjust = get('10-adjust-v2'), adjustRetry = get('11-adjust-retry'), closeAfter = get('12-close-after-adjust');
  const adjusted = get('13-adjusted').response as ReplayPeriod, verified = get('14-receipts-1').response as ReplayPeriod;
  const v2 = adjust.response.snapshot;
  const expectedUnits = acceptedEvents.reduce((sum, event) => sum + event.units, 0);
  const receiptIds = verified.events.filter(event => typeof event.processed_at === 'string').map(event => event.event_id);
  return {
    schema_version: 1, mode: 'recorded_aws_replay', recorded_at: get('14-receipts-1').at, source_commit: '819c512', region: 'us-east-1',
    notice: 'Read-only replay of recorded AWS API responses. This walkthrough sends no usage writes and does not show live state. Reconstructed steps have no aggregate observation; a null receipt there means not observed, not proof of delayed processing.',
    steps: [
      { id: 'accept', title: 'Accept 750 units', summary: 'Three actual AWS ingestion responses accepted 100, 250 and 400 units. No period or processing observation was captured at this point.', view_basis: 'reconstructed', period: accepted, requests: seeds,
        checks: [check('All seed requests accepted', seeds.map(item => item.status), [201, 201, 201]), check('Accepted units', expectedUnits, 750), check('Ingestion classification', acceptedEvents.map(event => event.classification), ['ON_TIME', 'ON_TIME', 'ON_TIME']), check('No duplicate ingestion', seeds.map(item => item.response.duplicate), [false, false, false])] },
      { id: 'close', title: 'Preserve snapshot v1', summary: 'The recorded close response contains a 750-unit snapshot. The aggregate at close was not observed; this replay does not claim that processing lagged.', view_basis: 'reconstructed', period: closed, requests: [close],
        checks: [check('Close response status', close.status, 200), check('Snapshot units equal accepted usage', v1.units, expectedUnits), check('Snapshot membership', v1.event_ids, acceptedIds), check('Original snapshot version', v1.version, 1)] },
      { id: 'late', title: 'Make 100 late units explicit', summary: 'A post-close event was accepted. The captured period response shows 100 pending units and the unchanged original snapshot.', view_basis: 'recorded_period', period: pending, requests: [late, get('06-pending')],
        checks: [check('Late event response status', late.status, 201), check('Late event classification', late.response.event.classification, 'POST_CLOSE'), check('Pending units', pending.pending.units, late.response.event.units), check('Pending membership', pending.pending.event_ids, [late.response.event.event_id]), check('Original snapshot unchanged', isDeepStrictEqual(pending.snapshots[0], v1), true)] },
      { id: 'retry', title: 'Retry without changing the meaning', summary: 'The duplicate returned its original event, a changed payload returned 409, and close returned v1. The view carries the last captured period forward; aggregate state was not observed during these requests.', view_basis: 'reconstructed', period: retry, requests: [duplicate, conflict, closeRetry],
        checks: [check('Duplicate response status', duplicate.status, 200), check('Duplicate flagged', duplicate.response.duplicate, true), check('Original accepted event returned', isDeepStrictEqual(duplicate.response.event, seeds[0].response.event), true), check('Changed payload status', conflict.status, 409), check('Changed payload error', conflict.response.error, 'IDEMPOTENCY_MISMATCH'), check('Close retry returns original snapshot', isDeepStrictEqual(closeRetry.response.snapshot, v1), true)] },
      { id: 'adjust', title: 'Publish snapshot v2 at 850 units', summary: 'The adjustment added only evt_004. Recorded retries returned the existing snapshots, and the captured period preserved v1 alongside v2.', view_basis: 'recorded_period', period: adjusted, requests: [adjust, adjustRetry, closeAfter, get('13-adjusted')],
        checks: [check('Adjusted units', v2.units, expectedUnits + late.response.event.units), check('Added event membership', v2.added_event_ids, [late.response.event.event_id]), check('Adjustment retry preserves v2', isDeepStrictEqual(adjustRetry.response.snapshot, v2), true), check('Close after adjustment returns v1', isDeepStrictEqual(closeAfter.response.snapshot, v1), true), check('Original snapshot unchanged', isDeepStrictEqual(adjusted.snapshots[0], v1), true), check('Captured v2 matches adjustment response', isDeepStrictEqual(adjusted.snapshots[1], v2), true), check('No pending units', adjusted.pending.units, 0)] },
      { id: 'verify', title: 'Inspect the recorded stream receipts', summary: 'The final AWS period response contains all four processing receipts. The ON_TIME projection remains 750 units while adjusted snapshot v2 is 850 units.', view_basis: 'recorded_period', period: verified, requests: [get('14-receipts-1')],
        checks: [check('Final observation status', get('14-receipts-1').status, 200), check('Processing receipts observed', receiptIds, [...acceptedIds, late.response.event.event_id]), check('ON_TIME aggregate units', verified.aggregate?.units, expectedUnits), check('ON_TIME processed events', verified.aggregate?.processed_events, acceptedIds.length), check('Original snapshot unchanged', isDeepStrictEqual(verified.snapshots[0], v1), true), check('Adjusted snapshot unchanged', isDeepStrictEqual(verified.snapshots[1], v2), true), check('No active build', verified.building, null)] },
    ],
  };
}
if (require.main === module) {
  const sourceDirectory = process.argv[2];
  if (!sourceDirectory) throw new Error('Usage: node --import tsx scripts/build-replay.ts PRIVATE_SMOKE_DIRECTORY [web/replay.json]');
  const records = Object.fromEntries(REPLAY_FILES.map(name => [name, JSON.parse(readFileSync(resolve(sourceDirectory, `${name}.json`), 'utf8'))]));
  const replay = buildReplay(records);
  writeFileSync(resolve(process.argv[3] ?? 'web/replay.json'), JSON.stringify(replay, null, 2) + '\n');
  console.log(`Exported ${replay.steps.length} recorded steps; ${replay.steps.flatMap(step => step.checks).filter(item => !item.passed).length} failed recorded checks.`);
}
