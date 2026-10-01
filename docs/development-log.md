# Development log

## 2026-09-28 — Local deployable vertical slice

- Read the referenced design discussion and used the latest frozen usage-snapshot semantics. Removed old restatement/accounting terminology from the product.
- Initialized a standalone TypeScript/CDK repository. Codex split backend correctness, one-screen UI, and infrastructure into parallel implementation tasks, then coordinated shared DTOs and reviewed integration boundaries.
- Implemented ingestion classification with a period condition, immutable ledger append and unique event ID in one DynamoDB transaction.
- Added a resumable acceptance-epoch fence for close and adjustment. Derived snapshot totals from bounded, strongly consistent ledger queries, independent of consumer progress.
- Implemented atomic processing receipts and ON_TIME aggregation, partial batch retries and immutable snapshot history.
- Created the ACME September demonstration with original $7.50, explicit +$1.00 usage and adjusted $8.50 derivation.
- Caught and corrected two integration defects during agent review: the stream discriminator must match the persisted `entity` field, and standalone transaction conditions need IAM `dynamodb:ConditionCheckItem`.
- Downloaded AWS's official DynamoDB Local, verified its SHA-256 checksum and ran actual SDK transaction tests with forced pagination, races and crash recovery.
- User selected **local deployable version first**. No AWS deployment or authenticated AWS API call is claimed for this milestone. Evidence capture tooling is prepared for the later selected AWS account/Region.

Final executed verification is recorded in `evidence/local-verification.md`. This log describes real work; it does not claim competition eligibility or replace future AWS deployment evidence.

## 2026-09-29 — Combined local correctness scenario

- User requested a more demanding demonstration within the existing metering semantics. Added an eight-step local scenario that combines deliberate delivery lag, retries across close, older post-close usage, an interrupted adjustment and recovery across three immutable versions.
- Reused the real domain service and DynamoDB transaction implementation. All shown totals and evidence checks are derived from persisted data. The interruption is explicitly injected by a local store wrapper and is never described as a real Lambda crash.
- Isolated each run in a partition namespace, retained the original demonstration, and added a target-specific atomic checkpoint so the local scenario can resume after refresh or server restart.
- Kept scenario routes and fault orchestration outside the deployed Lambda entry points. No additional AWS service or cloud deployment was introduced.
- Added tests for the composed sequence, repeated requests, persisted progress recovery and namespace isolation. Final executed results for this revision are recorded separately in `evidence/scenario-verification.md`.

## 2026-09-29 — Review closeout: policy and interface contract

- Reviewed the external findings against the code. Kept the frozen domain/transaction implementation and added a controlled-demo operating policy, responsibility matrix and explicit distinction between human procedures and enforced controls.
- Documented acceptance/build timestamps, cumulative snapshot semantics, operation retry identities, separate period reads and pending relative to the returned snapshot. Qualified ledger authority to accepted reports and clarified source-completeness and privileged-write limits.
- Added compact record guidance to the screen and enabled the existing ON_TIME ledger/projection comparison in basic mode. Kept simulated held-delivery wording local and avoided diagnosing cloud faults from a gap alone.
- Prepared a selected-target cloud verification runbook without executing AWS calls. Distinguished the ordinary local ledger-polling worker from the deployed path, which has no automatic ledger replay.
- Re-ran 22 automated tests and verified both UI modes in the browser, including the synthesized API handler against DynamoDB Local. Results and limits are recorded in `evidence/review-closeout.md`.


## 2026-09-30 — First AWS deployment and observed Streams verification

- User selected their personal AWS account and us-east-1. Old profiles could not authenticate (expired temporary credentials / no credentials); a separate browser-login profile was created and Codex saved a sanitized successful STS connection record.
- Reused the existing CDK bootstrap version 30, reviewed the actual template diff, and deployed application commit `819c512` without changing product scope. CloudFormation reached CREATE_COMPLETE.
- Re-ran type checking, 13 unit/infrastructure tests and synthesis/bundling. Verified 29 actual cloud configuration/IAM conditions, then 33 API/data assertions across 16 HTTP requests using four synthetic events.
- Observed all four real stream-processing receipts, an ON_TIME-only aggregate of 750, immutable v1 at $7.50, and adjusted v2 at $8.50. No manual consumer invocation, data reset or cloud fault injection was performed.
- Saved private deployment/API/log evidence and published a sanitized verification summary, assertion results and screenshot. Retained the executed standard-library API smoke verifier for reproducibility. Browser verification checked both snapshot derivations.
- The execution used temporary root-session credentials with CDK same-account fallback after helper-role assumption warnings. No bootstrap permission changes were made. No cost alert, automatic shutdown, production authorization control or spending cap was added. See `evidence/cloud-verification.md` for evidence and limits.
