# Cloud verification runbook

**Status: executed for the selected us-east-1 deployment on September 30, 2026.** See [actual results and limits](../evidence/cloud-verification.md). The deployed demonstration now contains preserved snapshots; do not rerun the fresh-state sequence or reset its data. For any future deployment, begin AWS work only after the user selects the profile, account and Region. Once selected, proceed within the existing authorization; the review below checks that the actual changes stay within that scope.

The cloud API is unauthenticated and fixed to **ACME / September 2026 / 1 cent per unit**. Use synthetic usage only. Other callers can alter its demo state. The local eight-step controller and its fault injection are not deployed.

## 1. Verify the selected identity and review the deployment

From the project root, replace the placeholders with the selected target. Keep evidence private until reviewed; do not save credentials or publish raw account IDs, role ARNs or the writable endpoint.

```sh
export AWS_PROFILE='SELECTED_PROFILE'
export AWS_REGION='SELECTED_REGION'
export MP_EXPECTED_ACCOUNT_ID='SELECTED_12_DIGIT_ACCOUNT_ID'
export MP_CLOUD_EVIDENCE='work/cloud-smoke-selected-target'
mkdir -p "$MP_CLOUD_EVIDENCE"

MP_ACTUAL_ACCOUNT_ID=$(aws --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --no-cli-pager sts get-caller-identity --query Account --output text)
test "$MP_ACTUAL_ACCOUNT_ID" = "$MP_EXPECTED_ACCOUNT_ID"
```

**Stop if that command fails or the identity differs.** Also inspect the caller role privately to confirm it is the intended principal. Record its identity using the existing read-only evidence command:

```sh
# Set actor to the actual executor; use Codex only when Codex runs this command.
EVIDENCE_ACTOR='ACTUAL_EXECUTOR' npm run evidence:aws
npm run check
npm run cdk -- diff MeterProof --method template \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  > "$MP_CLOUD_EVIDENCE/cdk-diff.txt" 2>&1
```

Read the diff and command result before proceeding. `--method template` avoids creating a CloudFormation change set for this comparison; it cannot fully predict resource replacement behavior. Review the named stack, its existing resources, both table retention policies, IAM changes, public routes and generated assets. Stop on unexpected replacements, deletions, unrelated resources or failures. If the target lacks CDK bootstrap resources, inspect the required bootstrap changes for that exact account/Region before proceeding; do not bootstrap an unknown target automatically. Resolve any change outside the authorized scope before deployment.

After selecting the target and reviewing the changes within the authorized scope:

```sh
npm run cdk -- deploy MeterProof --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --outputs-file "$MP_CLOUD_EVIDENCE/outputs.json" \
  > "$MP_CLOUD_EVIDENCE/deploy.txt" 2>&1
aws --profile "$AWS_PROFILE" --region "$AWS_REGION" --no-cli-pager \
  cloudformation describe-stacks --stack-name MeterProof \
  > "$MP_CLOUD_EVIDENCE/stack.json"
aws --profile "$AWS_PROFILE" --region "$AWS_REGION" --no-cli-pager \
  cloudformation list-stack-resources --stack-name MeterProof \
  > "$MP_CLOUD_EVIDENCE/resources.json"
```

Require successful CloudFormation completion. Resolve the API, table names, Lambda functions, roles and mapping from this stack's actual outputs/resources. Never guess physical names. No reset, table deletion, stack deletion or unrelated-resource creation belongs in this smoke test.

## 2. Inspect the deployed wiring and starting state

Save read-only observations for the resolved resources, using the same profile/Region:

- API Gateway routes and integrations match `/`, `/api/health`, `/api/period`, `/api/events`, `/api/close`, `/api/adjust`. Local `/api/demo` routes are absent.
- Both Lambdas reference this stack's two tables; `DYNAMODB_ENDPOINT` is absent. A health response of `mode: "aws"` is an application label, not independent proof of deployment.
- The ledger has `NEW_IMAGE` Streams enabled. The meter mapping targets that exact stream, is enabled, filters `INSERT` plus `NewImage.entity.S = EVENT`, uses batch size 100 and `ReportBatchItemFailures`, and has the reviewed retry configuration. Save its state and processing-result diagnostics.
- Actual role policies match the reviewed template: API ledger Get/Query/Put, API state Get/Query/Put/Update/ConditionCheck, meter state Put/Update plus stream-read/log permissions. Inspect any additional policies too. Ledger immutability relies on conditional application writes; granting PutItem alone is not an IAM-enforced write-once guarantee.

Set `MP_API` from the verified `ApiUrl` output, without a trailing slash. The following helpers save response bodies, headers and status codes. Run commands one at a time and stop when a helper fails or an observed invariant differs. No automatic retry changes an event ID or expected version.

```sh
export MP_API='https://VERIFIED_API_HOST'
mp_call() {
  local MP_NAME="$1" MP_EXPECTED="$2" MP_STATUS
  shift 2
  MP_STATUS=$(curl --silent --show-error --connect-timeout 5 --max-time 30 \
    --dump-header "$MP_CLOUD_EVIDENCE/$MP_NAME.headers" \
    --output "$MP_CLOUD_EVIDENCE/$MP_NAME.json" --write-out '%{http_code}' "$@") || return 1
  printf '%s\n' "$MP_STATUS" > "$MP_CLOUD_EVIDENCE/$MP_NAME.status"
  cat "$MP_CLOUD_EVIDENCE/$MP_NAME.json"
  printf '\nHTTP %s\n' "$MP_STATUS"
  test "$MP_STATUS" = "$MP_EXPECTED"
}
mp_post() {
  mp_call "$1" "$4" --request POST --header 'Content-Type: application/json' \
    --data "$3" "$MP_API$2"
}
mp_call health 200 "$MP_API/api/health"
mp_call before 200 "$MP_API/api/period"
```

`GET /api/period` lazily initializes empty period metadata if needed; it does not add usage. Before any event POST, verify the response is ACME / `2026-09`, `OPEN`, `latest_version: 0`, `building: null`, empty events/snapshots/pending, and zero aggregate units/processed events.

**If data already exists, stop the fresh-run sequence.** Review it against a previously saved transcript and resume only at the matching known step. An already completed, matching run can be inspected and its idempotent requests replayed. Do not invent new IDs to bypass collisions, reset a closed period, delete rows, or silently mix this smoke test with existing usage. A separate deployment requires its own explicit target review.

## 3. Exercise the original $7.50 → +$1.00 → $8.50 path

These bodies are synthetic. Occurrence time is producer data; acceptance/processing timestamps are server observations. Cutoff membership is established by the ingestion transaction, not by comparing those wall-clock timestamps.

```sh
mp_post seed-001 /api/events '{"event_id":"evt_001","occurred_at":"2026-09-01T12:00:00Z","units":100}' 201
mp_post seed-002 /api/events '{"event_id":"evt_002","occurred_at":"2026-09-02T12:00:00Z","units":250}' 201
mp_post seed-003 /api/events '{"event_id":"evt_003","occurred_at":"2026-09-03T12:00:00Z","units":400}' 201
mp_post close-v1 /api/close '{}' 200
mp_call closed 200 "$MP_API/api/period"
```

Require three ON_TIME ledger events and snapshot v1 containing exactly those IDs, `units: 750`, `amount_cents: 750`, `through_epoch: 0`. Save the entire v1 object for later equality checks. The aggregate may already be 750 or still lag; this sequence does not deliberately cause lag.

```sh
mp_post late-004 /api/events '{"event_id":"evt_004","occurred_at":"2026-09-01T08:00:00Z","units":100}' 201
mp_call pending 200 "$MP_API/api/period"
mp_post duplicate-001 /api/events '{"event_id":"evt_001","occurred_at":"2026-09-01T12:00:00Z","units":100}' 200
mp_post conflict-001 /api/events '{"event_id":"evt_001","occurred_at":"2026-09-01T12:00:00Z","units":101}' 409
mp_post close-retry /api/close '{}' 200
mp_post adjust-v2 /api/adjust '{"expected_version":1}' 200
mp_post adjust-retry /api/adjust '{"expected_version":1}' 200
mp_post close-after-adjust /api/close '{}' 200
mp_call adjusted 200 "$MP_API/api/period"
```

Check the saved responses, not only HTTP status:

- After `late-004`, evt_004 is POST_CLOSE in epoch 1, pending is exactly 100 units, and saved v1 is unchanged.
- The duplicate response has `duplicate: true` and the original accepted event, including its acceptance timestamp/classification. The changed payload returns `IDEMPOTENCY_MISMATCH`; the ledger retains 100 units for evt_001.
- Both close retries return the original v1, including the retry after adjustment.
- v2 contains exactly four IDs, 850 units/850 cents, `through_epoch: 1`, and `added_event_ids: ["evt_004"]`. The adjustment retry returns that same snapshot. There are exactly two snapshots, no active build, and no pending usage. v1 remains deeply equal to the saved original object.

For a timeout or 503, retain the failed attempt and inspect current state. Retry the same body/ID or `expected_version`; if a first event request committed but its response was lost, its retry correctly returns 200 with `duplicate: true`, rather than 201. Never treat a failed HTTP attempt as proof that nothing committed.

## 4. Observe real Streams processing within a fixed budget

Observe through the deployed API, without manually invoking the meter or changing its mapping. The following allows at most 30 observations, with five-second request timeouts and two-second pauses (under approximately 3.5 minutes). It checks all four receipts and the ON_TIME projection. Save every observation, including failures.

```sh
MP_RECEIPTS_OK=false
for MP_ATTEMPT in $(seq 1 30); do
  mp_call "receipts-$MP_ATTEMPT" 200 --max-time 5 "$MP_API/api/period" || break
  if node -e '
    const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const ids = ["evt_001", "evt_002", "evt_003", "evt_004"];
    const ok = p.events.length === 4 && ids.every(id => p.events.some(e => e.event_id === id && typeof e.processed_at === "string"))
      && p.aggregate.units === 750 && p.aggregate.amount_cents === 750 && p.aggregate.processed_events === 3;
    process.exit(ok ? 0 : 1);
  ' "$MP_CLOUD_EVIDENCE/receipts-$MP_ATTEMPT.json"; then
    MP_RECEIPTS_OK=true
    break
  fi
  sleep 2
done
printf 'stream_receipts_observed=%s\n' "$MP_RECEIPTS_OK"
```

The expected projection is **750, not 850**: POST_CLOSE evt_004 gets a processing receipt but never increments the ON_TIME aggregate. Receipt timestamps are processing observations, not a guarantee of exact database commit time or global ordering.

If the budget ends without receipts, report **inconclusive Streams delivery within the observation window**, retain evidence, and inspect the resolved mapping, Lambda errors/logs and iterator age. An IAM denial, disabled/wrong mapping, incorrect totals, extra snapshots, changed v1, or missing persisted events is a **failure**, not a passing smoke run. Do not hide failures by manually filling receipts or rebuilding the aggregate.

## 5. Record the result and its limits

Preserve a private transcript with commit SHA, timestamp, actual executor, selected target, sanitized STS record, reviewed diff, deployment completion, resource/IAM/mapping observations, API responses, bounded stream observations, and relevant Lambda logs. Redact credentials completely and account/role/resource identifiers or the writable API URL before public submission. Preserve failed attempts and distinguish **passed**, **failed**, **inconclusive**, and **not run** checks. STS evidence alone proves neither deployment nor hackathon eligibility.

A successful run demonstrates this deployed API sequence, persistence, application idempotency, snapshot preservation, and observed delivery through the real mapping. It does **not** prove ingestion/close concurrency, forced stream redelivery, partial-batch failure handling, interrupted Lambda recovery, adjustment-fence races, load capacity, or behavior after the 24-hour Streams retention window. Those need separate controlled cloud tests; local race/interruption tests and configuration inspection are supporting evidence, not substitutes. The stack has no failure destination/replay service: retry configuration does not extend stream retention, and permanent processing failures can leave the projection incomplete even though the ledger remains authoritative.
