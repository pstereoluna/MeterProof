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
