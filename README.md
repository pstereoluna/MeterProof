# MeterProof

**Preserve the reported usage. Explain what changed.**

MeterProof is an upstream usage-metering trust layer. Its frozen demonstration covers **ACME · September 2026**, at **1 cent per unit**:

1. Accept `evt_001` (100), `evt_002` (250), and `evt_003` (400).
2. Close a ledger-derived snapshot of accepted usage: **750 units / $7.50**.
3. Accept `evt_004` after close: **+100 units / +$1.00**, explicitly pending.
4. Publish adjusted snapshot v2: **850 units / $8.50**. Preserve v1 and show both derivations.

These are usage snapshots of accepted reports and estimated charges. Source truth and completeness are not independently verified. MeterProof does not issue invoices or move money. Read the [operating policy and responsibility matrix](docs/operating-policy.md) for the demonstration controls and their limits.

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
| GET | `/api/period` | ACME September state, snapshots, events, receipts and pending adjustments |
| POST | `/api/events` | `{ "event_id": "evt_001", "occurred_at": "2026-09-01T12:00:00Z", "units": 100 }` |
| POST | `/api/close` | `{}`; creates or recovers v1, always returns original v1 on retry |
| POST | `/api/adjust` | `{ "expected_version": 1 }`; creates or recovers v2 |

Event IDs are unique within the fixed customer/period. Reusing an ID with a different canonical payload returns 409. Retry 503 responses with the same event ID or expected version. `expected_version` is also the adjustment operation's idempotency key; resubmitting it returns that operation's result, even if a later version now exists.

Local-only scenario routes are `GET /api/demo`, `POST /api/demo/start`, and `POST /api/demo/step` with `{ "run_id": "...", "expected_step": 0 }`. They are absent from the deployed API Gateway and Lambda handler.

The sample usage dates are synthetic. `accepted_at` is a server sample taken before the successful ingestion transaction completes, not its exact commit time or a total event order. Cutoff is decided by transactional phase/epoch membership. `processed_at` belongs to the first successful processing receipt and never determines cutoff. `snapshot.created_at` records build start, not publication time. Period close is an explicit action, so the scenario can run on any date.

`GET /api/period` combines separate reads. Its pending amount is relative to the latest snapshot returned in that response; concurrent activity may require refresh. Published snapshot contents remain fixed. The ON_TIME projection can lag or stay incomplete without changing snapshot totals. Full response, retry and timestamp semantics are in the [API contract](docs/api-contract.md).

## Deploy later

**This build has not been deployed to AWS. The requested milestone is local and deployable.**

The CDK stack creates API Gateway HTTP API, two Lambda functions, two DynamoDB tables, a DynamoDB Stream event-source mapping, and their IAM/logging resources. The API Lambda serves the HTML, avoiding extra frontend hosting services. Standard CDK bootstrap asset storage is deployment tooling, not a product service.

Use the [cloud verification runbook](docs/cloud-verification.md) after an AWS target has been selected. It separates actual cloud evidence from local results and preserves existing demonstration data. Deployment commands are:

```sh
export AWS_PROFILE=your-selected-profile
export AWS_REGION=us-east-1
EVIDENCE_ACTOR=Codex npm run evidence:aws
# Bootstrap the selected account/Region only if it is not already bootstrapped.
npm run cdk -- bootstrap --profile "$AWS_PROFILE"
npm run cdk -- diff --profile "$AWS_PROFILE"
npm run cdk -- deploy --profile "$AWS_PROFILE" --outputs-file outputs.json
```

Record the actual agent-run connection/deployment results before claiming AWS integration in the submission. `evidence:aws` performs only `sts:GetCallerIdentity`, hashes the identity, and records success or failure without saving credentials. Use `EVIDENCE_ACTOR=Codex` only when Codex actually invokes it. Local verification does not prove cloud IAM, API Gateway behavior or Streams delivery.

Auth is intentionally absent: a deployed endpoint permits any caller to change the demo data. Use synthetic data. Tables are retained on stack deletion to preserve ledger/snapshot history; deleting the stack alone will not remove them. This behavior and cloud costs must be considered when retiring the demo.

## Frozen boundary

No auth, Stripe/payments/invoices, quotas, WebSockets, SQS, EventBridge, Step Functions, Kinesis, Athena, hash chains, charts, multi-currency, customer-management UI, or AI inside the product. The coding agent contributes to implementation and verification.

Read [architecture](docs/architecture.md), [operating policy](docs/operating-policy.md), [API contract](docs/api-contract.md), [development log](docs/development-log.md), and [evidence status](evidence/README.md).
