# MeterProof

**Preserve the reported usage. Explain what changed.**

[Open the recorded AWS walkthrough](https://iqqd5bi25e.execute-api.us-east-1.amazonaws.com/) · [Latest verification](evidence/release-2026-10-02.md)

MeterProof is an upstream usage-metering trust layer. Its frozen demonstration covers **ACME · September 2026**, at **1 cent per unit**:

1. Accept `evt_001` (100), `evt_002` (250), and `evt_003` (400).
2. Close a ledger-derived snapshot of accepted usage: **750 units / $7.50**.
3. Accept `evt_004` after close: **+100 units / +$1.00**, explicitly pending.
4. Publish adjusted snapshot v2: **850 units / $8.50**. Preserve v1 and show both derivations.

These are usage snapshots of accepted reports and estimated charges. Source truth and completeness are not independently verified. MeterProof does not issue invoices or move money. Read the [operating policy and responsibility matrix](docs/operating-policy.md) for the demonstration controls and their limits.

## Follow the recorded AWS result

**Latest release deployed and verified on October 2, 2026.** The numeric-overflow fix passed 36 automated tests, 36 public-browser assertions and 17 read-only cloud checks. Both deployed Lambda bundles match the tested artifacts; the existing live period and saved walkthrough are unchanged. See the [latest verification](evidence/release-2026-10-02.md). The October 1 visual revisions and original September 30 cloud run remain completed historical milestones.

The revision makes the action and result of each recorded step visible: three events total **$7.50** → their members form **v1** → a late **+$1.00** remains outside v1 → duplicate and conflicting retries add **no usage** → a separate **v2 reaches $8.50** → compare the original v1 before and after adjustment. The last step verifies preservation; it does not imply another state change. Ledger membership, derivations, raw requests and detailed checks are expandable beneath the story.

This six-step, **read-only recorded AWS walkthrough** uses sanitized requests and responses from the actual September 30, 2026 Pacific / October 1 UTC cloud run of source commit [`819c512`](https://github.com/pstereoluna/MeterProof/tree/819c512). Visitors can revisit the evidence without submitting new usage, closing a period, or resetting shared data. Early views reconstructed from successful replies are labeled; an aggregate that was not captured is **not observed**, not zero. Full period captures are used where available.

The primary mode selector is replaced by a secondary [current AWS record link](https://iqqd5bi25e.execute-api.us-east-1.amazonaws.com/?view=live), which separately reads the deployed `/api/period`. A recorded result is not a claim about current service health. The local eight-step simulator below remains available for controlled delivery and interruption testing. See the [walkthrough and evidence boundaries](docs/demo-walkthrough.md).

The target situation is narrow: a SaaS engineer and finance operator need to explain why a closed 750-unit report now has another 100 units, while proving the original report stayed unchanged. Existing metering and billing products already serve this market; MeterProof is a focused reference implementation of cutoff guarantees, not a claim of commercial uniqueness or validated customer demand.

Public review links: [source](https://github.com/pstereoluna/MeterProof/tree/main/src), [tests](https://github.com/pstereoluna/MeterProof/tree/main/test), [executed cloud evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/cloud-verification.md), and the [Builder Center project](https://builder.aws.com/project/3JzE9LF8ZJamr5T1eQDm6uNGngR/meterproof-explain-every-change-in-reported-usage). A proposed project-page update is in [submission.md](docs/submission.md); it has not been posted automatically.

## Run locally

Requires Node.js 22+ and Java 17+. The lockfile pins JavaScript dependencies.

```sh
npm ci
npm run setup:local
npm run db
```

Keep DynamoDB Local running. In a second terminal:

```sh
npm run dev
```

Preview the recorded walkthrough locally at **http://127.0.0.1:3000/?view=replay**.

Open **http://127.0.0.1:3000**. The local page offers an **eight-step correctness scenario**: ledger 750 / projection 350, close, five retries, older post-close events, an interrupted adjustment, recovery to **$10.50**, a final **$11.00** snapshot, and a rejected conflicting payload. Follow the next-step button and inspect the returned evidence.

Data persists in `.local/dynamodb/`; scenario progress persists in a target-specific `.local/scenario-<hash>.json`. Refreshing or restarting resumes the active run. **New run** creates an isolated namespace and preserves prior runs and the original $7.50 / $8.50 demonstration. See [the complete scenario](docs/scenario.md).

The combined local screen is marked **LOCAL SCENARIO**. It runs the real DynamoDB transaction implementation against AWS's downloadable DynamoDB Local. The basic demo uses a local polling worker. The eight-step scenario explicitly controls deliveries and injects an interruption after a real durable fence. Neither is an AWS Lambda event-source mapping or an actual Lambda process crash. Neither local command reads AWS credentials or creates AWS resources.

Use **New run** to repeat the local scenario without deleting data. To use a separate pair of local tables instead:

```sh
LEDGER_TABLE=MeterProofDemo2Ledger STATE_TABLE=MeterProofDemo2State npm run dev
```

## Verify

```sh
npm run check
# With DynamoDB Local running:
npm run test:integration
```

The checks include TypeScript validation, domain/handler tests, CDK assertions, real Lambda asset bundling, and CloudFormation synthesis. Integration tests use isolated local tables and remove only those test tables on completion. They cover the original $7.50 → +$1.00 → $8.50 scenario, duplicate delivery, payload mismatch, lag at close, forced query pagination, crash recovery, and transaction races. Additional scenario tests verify the complete eight-step sequence, checkpoint retry/restart behavior and namespace isolation.

## Project structure

```text
src/                 Domain, DynamoDB transactions, HTTP and stream handlers
infra/               CDK application and stack
web/index.html       One screen, no frontend framework or remote dependencies
scripts/             Local runner, local database setup, AWS evidence capture
test/                Domain, handler, infrastructure, and local integration tests
docs/                Architecture, API contract, operating policy, verification plans
evidence/            Verification record and honest AWS evidence status
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Single demo screen |
| GET | `/api/health` | Process health and environment label |
| GET | `/api/replay` | Recorded AWS walkthrough evidence; sanitized saved responses; no metering writes |
| GET | `/api/period` | ACME September state, snapshots, events, receipts and pending adjustments |
| POST | `/api/events` | `{ "event_id": "evt_001", "occurred_at": "2026-09-01T12:00:00Z", "units": 100 }` |
| POST | `/api/close` | `{}`; creates or recovers v1, always returns original v1 on retry |
| POST | `/api/adjust` | `{ "expected_version": 1 }`; creates or recovers v2 |

Event IDs are unique within the fixed customer/period. Reusing an ID with a different canonical payload returns 409. Retry 503 responses with the same event ID or expected version. `expected_version` is also the adjustment operation's idempotency key; resubmitting it returns that operation's result, even if a later version now exists.

Local-only scenario routes are `GET /api/demo`, `POST /api/demo/start`, and `POST /api/demo/step` with `{ "run_id": "...", "expected_step": 0 }`. They are absent from the deployed API Gateway and Lambda handler.

The sample usage dates are synthetic. `accepted_at` is a server sample taken before the successful ingestion transaction completes, not its exact commit time or a total event order. Cutoff is decided by transactional phase/epoch membership. `processed_at` belongs to the first successful processing receipt and never determines cutoff. `snapshot.created_at` records build start, not publication time. Period close is an explicit action, so the scenario can run on any date.

`GET /api/period` combines separate reads. Its pending amount is relative to the latest snapshot returned in that response; concurrent activity may require refresh. Published snapshot contents remain fixed. The ON_TIME projection can lag or stay incomplete without changing snapshot totals. Full response, retry and timestamp semantics are in the [API contract](docs/api-contract.md).

## AWS deployment

**Deployed and verified in us-east-1 on September 30, 2026.** The cloud smoke preserved $7.50 → +$1.00 → $8.50, checked actual application IAM and Streams wiring, and observed all four real processing receipts. See the [cloud verification evidence](evidence/cloud-verification.md) for exact checks and limits. The local eight-step fault scenario is not deployed.

The CDK stack creates API Gateway HTTP API, two Lambda functions, two DynamoDB tables, a DynamoDB Stream event-source mapping, and their IAM/logging resources. The API Lambda serves the HTML, avoiding extra frontend hosting services. Standard CDK bootstrap asset storage is deployment tooling, not a product service.

Use the [cloud verification runbook](docs/cloud-verification.md) after an AWS target has been selected. It separates actual cloud evidence from local results and preserves existing demonstration data. Deployment commands are:

```sh
export AWS_PROFILE=your-selected-profile
export AWS_REGION=us-east-1
EVIDENCE_ACTOR=Codex npm run evidence:aws
# Bootstrap the selected account/Region only if it is not already bootstrapped.
npm run cdk -- bootstrap --profile "$AWS_PROFILE" --region "$AWS_REGION"
npm run cdk -- diff MeterProof --method template --profile "$AWS_PROFILE" --region "$AWS_REGION"
npm run cdk -- deploy MeterProof --profile "$AWS_PROFILE" --region "$AWS_REGION" --outputs-file outputs.json
```

Record the actual agent-run connection/deployment results before claiming AWS integration in the submission. `evidence:aws` performs only `sts:GetCallerIdentity`, hashes the identity, and records success or failure without saving credentials. Use `EVIDENCE_ACTOR=Codex` only when Codex actually invokes it. Local verification does not prove cloud IAM, API Gateway behavior or Streams delivery.

Auth is intentionally absent: the existing deployed POST endpoints permit any caller to change the demo data. Read-only walkthrough controls do not secure those endpoints. Use synthetic data. Tables are retained on stack deletion to preserve ledger/snapshot history; deleting the stack alone will not remove them. This behavior and cloud costs must be considered when retiring the demo.

## Frozen boundary

No auth, Stripe/payments/invoices, quotas, WebSockets, SQS, EventBridge, Step Functions, Kinesis, Athena, hash chains, charts, multi-currency, customer-management UI, or AI inside the product. The coding agent contributes to implementation and verification.

Read [architecture](docs/architecture.md), [operating policy](docs/operating-policy.md), [API contract](docs/api-contract.md), [development log](docs/development-log.md), and [evidence status](evidence/README.md).
