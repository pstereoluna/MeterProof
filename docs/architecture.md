# Frozen architecture and correctness boundaries

```text
One demo screen → API Gateway → API Lambda → DynamoDB ledger + state
                                                │ ledger stream
                                                ▼
                                          Metering Lambda
                                                │
                                      receipt + read-model transaction
```

## Presentation paths

**The recorded-walkthrough update is verified and deployed to AWS on October 1, 2026.** It adds no AWS services and does not change ingestion, fencing or snapshot transactions.

The updated public UI's default is a read-only six-step walkthrough served by `GET /api/replay`. Its sanitized artifact comes from the actual AWS API run of source commit `819c512` on September 30, 2026 Pacific / October 1 UTC. Full period captures are used where available; earlier views reconstructed from successful replies are labeled and leave an unobserved aggregate null. Browsing these records does not execute the recorded POSTs or reset cloud data.

The separate **View live record** action reads `/api/period`. The existing local eight-step controller still runs against DynamoDB Local and deliberately controls delivery and injects an interruption. Recorded AWS evidence, current AWS reads and local fault simulation remain distinguishable. See [the walkthrough guide](demo-walkthrough.md).

## Three times, one cutoff

- `occurred_at`: producer-provided September 2026 UTC usage time.
- `accepted_at`: server timestamp sampled immediately before the successful ingestion transaction attempt. DynamoDB does not expose an exact item commit timestamp. The durable ledger entry means acceptance succeeded; **phase/epoch membership**, rather than clock comparisons, determines cutoff.
- `processed_at`: timestamp stored with the first successful asynchronous processing receipt. It never determines cutoff and is never written back over the ledger event.

Ingestion reads the period and atomically performs three operations: check the observed phase and acceptance epoch, append the immutable ledger event, and claim its unique event ID. If a fence wins first, the transaction fails, rereads and retries using the new epoch. A duplicate resolves to its original event, including its original classification and timestamp.

## A closed ledger range, then a snapshot

`OPEN` begins at epoch 0. Closing conditionally changes the period to `CLOSED`, advances the acceptance epoch to 1, and stores a durable build record for snapshot v1 with fence 0. This update competes serializably with ingestion's transaction condition.

Future ingestion cannot write epoch 0. A **strongly consistent, paginated base-table Query** can now read a stable, bounded set of immutable events. This is why it is safe to derive v1 without waiting for the stream. Strong consistency by itself would not make an arbitrary moving multi-page query a point-in-time snapshot.

Publication is a transaction: conditionally put a previously nonexistent snapshot, advance the latest-version pointer only for that build operation, and clear the build record. A process failure after fencing can be recovered by calling the same close or adjustment operation. A close retry always returns v1, even after later adjustments.

Adjustment follows the same procedure: fence the current epoch and advance it, derive the complete next snapshot from all bounded epochs, and record the new event IDs relative to the prior immutable version. Events accepted after the adjustment fence remain pending for the next adjustment. The period remains closed throughout.

## Durable items

Both tables use `pk` / `sk`; the demo partition is `CUSTOMER#ACME#PERIOD#2026-09`.

| Table | Sort key | Purpose |
| --- | --- | --- |
| Ledger | `EVENT#<16-digit epoch>#<event_id>` | Immutable usage, classification and acceptance membership |
| Ledger | `IDEMPOTENCY#<event_id>` | Canonical payload fingerprint and ledger event key |
| State | `PERIOD` | Phase, current acceptance epoch, latest version, resumable build |
| State | `SNAPSHOT#<12-digit version>` | Immutable total and contributing/new event IDs |
| State | `PROCESSED#<event_id>` | First successful processing timestamp |
| State | `AGGREGATE` | Eventually consistent projection of ON_TIME usage only |

The fingerprint detects a reused ID with changed content; it is not a hash chain or tamper-evidence claim. Snapshot amounts use integer cents at the fixed rate of one cent per unit.

## Asynchronous metering

The stream mapping accepts only `INSERT` records with `NewImage.entity.S = EVENT`. The worker retains ingestion classification. For ON_TIME events, one transaction claims the processing receipt and increments the aggregate. POST_CLOSE events get a receipt but cannot mutate the ON_TIME aggregate or any snapshot. Duplicate receipts fail the conditional put, so the entire increment is rolled back. Operational transaction conflicts are retried, not misclassified as duplicates.

The Lambda handler reports per-record failures using DynamoDB sequence numbers; the event-source mapping enables `ReportBatchItemFailures`. Independent successes can be redelivered and remain idempotent. Pending usage is derived directly from ledger membership minus the latest observed snapshot, so it does not depend on stream progress.

## Read and business boundaries

The [API contract](api-contract.md) documents timestamps, retry identity and the non-atomic period view. `snapshot.created_at` is the reserved build start time, not its publication time. Pending is computed against the latest snapshot observed in the same response. Period flags can temporarily differ from later snapshot reads during concurrent work; each saved snapshot remains immutable.

The [operating policy](operating-policy.md) separates source completeness, human close/adjust decisions and implemented transaction controls. No identity, authorization, approval or operator audit is enforced. Ledger authority covers accepted reports; it does not prove actual usage or all usage was reported.

## Intentional limits

- The period control item and per-customer aggregate are contention points. This is a small correctness demonstration, not a high-throughput or multi-region system.
- Snapshot membership lists must fit DynamoDB's 400 KB item limit; recomputation must fit the API/Lambda timeout. The base demonstration has four events and the combined local scenario has six. Large-period pagination and scalable membership storage are outside this milestone.
- DynamoDB Streams expires records after 24 hours. A long consumer outage can leave the aggregate incomplete. Ledger-derived close still works. The UI can compare ON_TIME ledger usage with the projection and show missing receipts, but cannot diagnose the cause from that difference alone. Automated alerting, repair and dead-letter infrastructure are outside the frozen MVP.
- The UI is a read of current observations, not a cross-table read transaction. Immutable displayed snapshots remain reproducible; concurrent actions may require refresh.
- Application ledger writes use conditional creates. The application roles are not granted ledger UpdateItem/DeleteItem, but PutItem permission itself does not enforce append-only storage: other code or administrators with sufficient permissions can replace records. Immutability relies on the trusted application path and administration; this is not cryptographic tamper resistance.
- Domain tests and DynamoDB Local cannot prove AWS IAM enforcement or cloud delivery. The [September 30 AWS smoke](../evidence/cloud-verification.md) verified the recorded deployed sequence, actual wiring and real processing receipts for commit `819c512`; it did not force cloud lag, races, redelivery or a Lambda crash. The newer walkthrough was also [deployed and verified](../evidence/walkthrough-verification.md) on October 1, 2026.

## Primary references used during implementation

- [DynamoDB transaction isolation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
- [DynamoDB transaction IAM actions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)
- [Lambda partial batch failures for DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html)
- [AWS DynamoDB Local setup](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
