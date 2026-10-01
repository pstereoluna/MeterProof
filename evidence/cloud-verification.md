# AWS deployment and cloud verification

Executed by Codex on **September 30, 2026, America/Los_Angeles**, against the user-selected AWS account in **us-east-1**. The deployed application source is commit `819c512`. The API smoke ran at 2026-10-01 04:03:42–04:03:48 UTC. These dates refer to the same local evening.

## Observed results

- Authenticated coding-agent-to-AWS connection verified with `sts:GetCallerIdentity`; the existing CDK bootstrap was version 30. No bootstrap stack or trust-policy change was needed.
- `npm run check` passed: TypeScript, **13 unit/infrastructure tests**, CDK synthesis and Lambda bundling. The prior nine DynamoDB Local integration tests were not rerun during this deployment; their earlier results remain in the local evidence.
- Reviewed the actual template diff, then deployed the unchanged application. CloudFormation reached **CREATE_COMPLETE**.
- **29 infrastructure assertions passed**, including actual tables, functions, environment variables, HTTP routes/integration, scoped application IAM policies and the enabled DynamoDB Streams mapping.
- **33 API/data assertions passed across 16 HTTP requests** against the deployed endpoint. The initial ledger was empty. Three ON_TIME events produced v1 at 750 units / $7.50. An older-occurrence POST_CLOSE event produced pending 100 units / $1.00, followed by v2 at 850 units / $8.50.
- Original v1 remained deeply equal through late ingestion, adjustment and retries. Identical event replay returned its original acceptance; changed-payload reuse returned `409 IDEMPOTENCY_MISMATCH`; close and adjustment retries returned their original snapshots.
- All four processing receipts were present at the first bounded observation. The real Streams mapping processed the events; no manual meter invocation or receipt repair was used. The ON_TIME projection was **750 units / 750 cents / three events**, correctly excluding the 100 POST_CLOSE units.
- Saved Lambda logs contained 22 API REPORT lines and three meter REPORT lines, with no `api_request_failed` or `meter_record_failed` entries in the captured window. This is a bounded observation, not ongoing monitoring.
- Browser verification showed the deployed screen, v1/v2 derivations, $7.50 original, +$1.00 adjustment and $8.50 latest total. No data was reset or deleted.

Machine-readable assertion results: [cloud-checks.json](cloud-checks.json). Screenshot: [cloud-demo.png](cloud-demo.png).

## Evidence and reproduction

The raw diff, deployment transcript, outputs, actual resource/IAM descriptions, HTTP requests/responses and Lambda logs are retained locally under the git-ignored `work/cloud-smoke-2026-09-30-us-east-1/` directory. The sanitized connection record is also git-ignored. This public summary omits account IDs, role ARNs, physical resource names and the writable endpoint.

The executed API verifier is retained as [scripts/cloud-smoke.py](../scripts/cloud-smoke.py). It uses only Python's standard library, reads `MeterProof.ApiUrl` from a CDK outputs file, refuses to reuse an evidence directory, requires a fresh empty period before event writes, preserves failed attempts, never automatically retries POSTs and makes at most 30 receipt observations. See the [runbook](../docs/cloud-verification.md) before using it on a separately reviewed fresh deployment. It will deliberately stop against this now-completed demonstration; it does not reset data.

## Limits and operational notes

This smoke verifies the observed deployed sequence and wiring. It does not establish production readiness, source completeness, authentication, business approval, load capacity, forced cloud race/crash recovery, stream redelivery behavior or recovery after stream retention expiry. The eight-step fault scenario remains local. Hackathon eligibility and submission have not been independently verified or submitted.

The operator's temporary browser login resolved to the account root identity. CDK reported that it could not assume bootstrap helper roles and used the same-account credentials instead; deployment succeeded without changing bootstrap permissions. This is recorded as an execution fact, not a recommended identity model for ongoing operations. The deployed Lambda roles were separately checked against the limited application policies.

The live demo is unauthenticated. Preserve synthetic data only. No cost alert, automatic shutdown or hard spending cap was created. Tables use RETAIN, and CDK bootstrap assets are separate: deleting the application stack alone would not remove all stored data or deployment assets. No cleanup has been performed.
