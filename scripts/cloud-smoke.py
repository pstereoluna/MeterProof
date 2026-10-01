import argparse
import datetime
import json
import pathlib
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--outputs', required=True)
parser.add_argument('--evidence-dir', required=True)
parser.add_argument('--actor', default='unspecified operator')
args = parser.parse_args()
base = json.loads(pathlib.Path(args.outputs).read_text())['MeterProof']['ApiUrl'].rstrip('/')
folder = pathlib.Path(args.evidence_dir)
folder.mkdir(mode=0o700, parents=False, exist_ok=False)
summary = {'executor': args.actor, 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'status': 'running', 'checks': [], 'http_requests': 0}

def save(name, value):
    (folder / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n')

def check(name, condition):
    summary['checks'].append({'name': name, 'passed': bool(condition)})
    save('summary', summary)
    if not condition:
        raise AssertionError(name)

def call(name, path, body=None, status=200, timeout=25):
    method = 'GET' if body is None else 'POST'
    record = {'request': {'method': method, 'path': path, 'body': body},
              'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    summary['http_requests'] += 1
    request = urllib.request.Request(base + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        try:
            response = urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read().decode()
            record['response'] = {'status': response.status, 'headers': dict(response.headers), 'body': raw}
        save(name, record)
        check(name + ' HTTP ' + str(status), record['response']['status'] == status)
        return json.loads(raw)
    except Exception as error:
        record['exception'] = type(error).__name__ + ': ' + str(error)
        save(name, record)
        raise

def snapshot_ok(snapshot, version, units, ids, added, epoch):
    return (snapshot['version'] == version and snapshot['units'] == units
        and snapshot['amount_cents'] == units and sorted(snapshot['event_ids']) == sorted(ids)
        and sorted(snapshot['added_event_ids']) == sorted(added) and snapshot['through_epoch'] == epoch)

try:
    health = call('01-health', '/api/health')
    check('health reports AWS handler', health == {'status': 'ok', 'service': 'MeterProof', 'mode': 'aws'})
    initial = call('02-before', '/api/period')
    check('fresh ACME September state', initial['customer_id'] == 'ACME' and initial['period'] == '2026-09'
          and initial['phase'] == 'OPEN' and initial['epoch'] == 0 and initial['latest_version'] == 0
          and initial['building'] is None and initial['events'] == [] and initial['snapshots'] == []
          and initial['pending'] == {'units': 0, 'amount_cents': 0, 'event_ids': []}
          and initial['aggregate']['units'] == 0 and initial['aggregate']['amount_cents'] == 0
          and initial['aggregate']['processed_events'] == 0)
    print('Fresh cloud state verified; beginning synthetic fixture.', flush=True)
    fixtures = [{'event_id': 'evt_001', 'occurred_at': '2026-09-01T12:00:00Z', 'units': 100},
                {'event_id': 'evt_002', 'occurred_at': '2026-09-02T12:00:00Z', 'units': 250},
                {'event_id': 'evt_003', 'occurred_at': '2026-09-03T12:00:00Z', 'units': 400}]
    accepted = []
    for index, event in enumerate(fixtures):
        result = call('03-seed-' + str(index + 1), '/api/events', event, 201)
        check(event['event_id'] + ' accepted ON_TIME once', result['duplicate'] is False
              and result['event']['classification'] == 'ON_TIME' and result['event']['epoch'] == 0
              and result['event']['units'] == event['units'])
        accepted.append(result['event'])
    ids = [e['event_id'] for e in fixtures]
    v1 = call('04-close-v1', '/api/close', {})['snapshot']
    check('v1 includes exact 750-unit ledger membership', snapshot_ok(v1, 1, 750, ids, ids, 0) and v1['kind'] == 'CLOSE')
    late = {'event_id': 'evt_004', 'occurred_at': '2026-09-01T08:00:00Z', 'units': 100}
    late_result = call('05-late', '/api/events', late, 201)
    check('older occurrence accepted POST_CLOSE epoch1', late_result['event']['classification'] == 'POST_CLOSE'
          and late_result['event']['epoch'] == 1 and late_result['duplicate'] is False)
    pending = call('06-pending', '/api/period')
    check('late 100 pending and v1 unchanged', pending['snapshots'] == [v1]
          and pending['pending'] == {'units': 100, 'amount_cents': 100, 'event_ids': ['evt_004']})
    duplicate = call('07-duplicate', '/api/events', fixtures[0])
    check('duplicate returns original acceptance', duplicate['duplicate'] is True and duplicate['event'] == accepted[0])
    conflict = call('08-conflict', '/api/events', dict(fixtures[0], units=101), 409)
    check('changed payload rejected', conflict['error'] == 'IDEMPOTENCY_MISMATCH')
    check('close retry returns original v1', call('09-close-retry', '/api/close', {})['snapshot'] == v1)
    v2 = call('10-adjust-v2', '/api/adjust', {'expected_version': 1})['snapshot']
    check('v2 exact 850 with explicit addition', snapshot_ok(v2, 2, 850, ids + ['evt_004'], ['evt_004'], 1) and v2['kind'] == 'ADJUST')
    check('adjust retry returns same v2', call('11-adjust-retry', '/api/adjust', {'expected_version': 1})['snapshot'] == v2)
    check('close after adjustment still returns v1', call('12-close-after-adjust', '/api/close', {})['snapshot'] == v1)
    final = call('13-adjusted', '/api/period')
    check('final versions, pending, build and membership intact', final['snapshots'] == [v1, v2]
          and final['latest_version'] == 2 and final['phase'] == 'CLOSED' and final['building'] is None
          and final['pending'] == {'units': 0, 'amount_cents': 0, 'event_ids': []}
          and sorted(e['event_id'] for e in final['events']) == sorted(ids + ['evt_004'])
          and sum(e['units'] for e in final['events']) == 850
          and next(e for e in final['events'] if e['event_id'] == 'evt_001')['units'] == 100)
    print('750 -> +100 -> 850 and idempotent retries passed; observing Streams.', flush=True)
    observed = False
    for attempt in range(1, 31):
        observation = call('14-receipts-' + str(attempt), '/api/period', timeout=5)
        check('observation ' + str(attempt) + ' preserves snapshots and projection bounds',
              observation['snapshots'] == [v1, v2] and len(observation['events']) == 4
              and observation['aggregate']['units'] <= 750 and observation['aggregate']['processed_events'] <= 3)
        receipts = all(isinstance(e.get('processed_at'), str) and e['processed_at'] for e in observation['events'])
        aggregate = observation['aggregate']
        if receipts:
            check('all receipts and ON_TIME-only 750 projection', aggregate['units'] == 750
                  and aggregate['amount_cents'] == 750 and aggregate['processed_events'] == 3)
            observed = True
            summary['stream_observation_attempts'] = attempt
            break
        if attempt < 30:
            time.sleep(2)
    summary['status'] = 'passed' if observed else 'inconclusive'
    summary['stream_receipts_observed'] = observed
    summary['limits'] = ['No forced cloud crash, race, load, stream redelivery or expiry test.',
                         'No manual meter invocation or receipt repair.',
                         'Existing synthetic snapshots retained; no reset.']
except Exception as error:
    summary['status'] = 'failed'
    summary['error'] = type(error).__name__ + ': ' + str(error)
finally:
    summary['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('summary', summary)
    print(json.dumps({'status': summary['status'], 'checks': len(summary['checks']),
                      'http_requests': summary['http_requests'], 'error': summary.get('error'),
                      'evidence_dir': str(folder)}), flush=True)
raise SystemExit(0 if summary['status'] == 'passed' else 2)
