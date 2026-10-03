# API contract and observation boundaries

This contract describes the current fixed ACME / September 2026 demonstration. All amounts are integer cents at one cent per unit. Requests are unauthenticated; no identity, role, approval or operator audit is enforced. Use synthetic data only. See [operating policy](operating-policy.md) for human responsibilities and explicitly unimplemented controls.

## Recorded walkthrough and live record

**Update status: verified and deployed to AWS on October 1, 2026.** The following describes the deployed read-only interface, separately from the already executed cloud run.

`GET /api/replay` returns sanitized recorded requests, responses and their presentation provenance for six steps: accept, close, late usage, retry, adjust and verify. The source is the actual September 30, 2026 Pacific / October 1 UTC AWS run of commit `819c512`, not requests issued by the visitor. Advancing or restarting the walkthrough does not call metering POST endpoints, alter the ledger, or reset the shared period.

Views assembled from successful API replies are identified as reconstructed views. For early steps without an observed aggregate, the walkthrough represents it as `null` / **not observed**, not a fabricated zero or a claim of processing lag. Captured full period responses are used where available. In reconstructed steps, `processed_at: null` means processing was not observed at that point, not proof of missing or delayed delivery. The recorded timeline does not establish cloud timing, races or failures beyond the observations in those responses.

**View live record** uses `GET /api/period` independently. The recorded result does not refresh itself from the live record, and a successful replay request does not verify DynamoDB or Streams health. Existing period responses keep their current aggregate shape; the recorded view's nullable aggregate is presentation provenance, not a change to live metering semantics. See [the walkthrough guide](demo-walkthrough.md) and [historical cloud verification](../evidence/cloud-verification.md).

## Accepting usage

`POST /api/events` accepts only `event_id`, `occurred_at` and `units`. The ID is 1–64 ASCII letters, digits, underscores or hyphens; occurrence must be a valid UTC ISO timestamp in September 2026 ending in `Z`; units must be a positive safe integer JSON number, at most `9007199254740991`. A string is not accepted as event input. The server owns classification, epoch, acceptance time and estimated amount. Additional fields are rejected.

```json
{"event_id":"evt_001","occurred_at":"2026-09-10T12:00:00Z","units":100}
```

A successful first acceptance returns `201` with `{ "event": ..., "duplicate": false }`. Repeating the same canonical payload with the same ID returns `200`, `duplicate: true`, and the original event, including its original classification and timestamp. Reusing that ID with different content returns `409 IDEMPOTENCY_MISMATCH` and preserves the accepted event.

An event is accepted when its ledger write and ID claim commit together with the period condition. A sent request or a lost response does not establish whether acceptance succeeded. After an ambiguous timeout, retry the identical payload with the same ID; do not invent a new ID. Different IDs for the same real-world usage are not deduplicated. Acceptance does not establish that the source reported true or complete usage.

## Exact totals and JSON representation

The `units` and `amount_cents` fields on snapshots, the aggregate and pending usage are exact nonnegative integers. A total at or below `Number.MAX_SAFE_INTEGER` (`9007199254740991`) is a JSON number; a larger total is a canonical decimal string containing only digits, with no sign, exponent, decimal point or leading zero. For example, accepting events of `9007199254740991` and `2` units produces the exact total `"9007199254740993"`. Individual event quantities and amounts remain safe integer JSON numbers at the fixed one-cent rate. The existing 750 / 850 demo responses retain their numeric representation.

Callers must preserve decimal strings or use exact integer arithmetic such as `BigInt`; coercing a large total to JavaScript `Number` loses precision. The UI also sums and formats quantities and cents exactly. This representation change adds no quota or usage threshold and does not change event membership, cutoff or snapshot immutability. Storage-size and execution-time limits still apply.

## Time fields and cutoff

| Field | Meaning | Must not be used as |
| --- | --- | --- |
| `event.occurred_at` | Producer-reported usage time, normalized to UTC; format/month are validated | Proof that usage occurred, source completeness, or acceptance order |
| `event.accepted_at` | Server clock sampled before the successful ingestion transaction attempt completes; retries return the original saved value | Exact database commit time, a total ordering of accepted events, or the cutoff decision |
| `event.processed_at` in the period view | Clock sample saved with the first successful processing receipt; `null` when no receipt was observed | Cutoff classification, snapshot readiness, or diagnosis of why processing is incomplete |
| `snapshot.created_at` | Start time of the reserved close/adjustment build, retained on recovery | Exact publication/completion time |

The ingestion transaction's **phase and epoch membership** decide cutoff. An event accepted before close belongs to v1 even if its receipt arrives later. If close wins first, ingestion retries against the new epoch and classifies the event `POST_CLOSE`. It remains September usage and becomes pending for a later snapshot. Sorting events by `accepted_at` is only a display convention; use stored classification, epochs and snapshot membership to explain inclusion. No exact within-epoch commit order is exposed.

## Close and adjustment

`POST /api/close` with `{}` reserves the original boundary and derives v1 from the ledger. A successful response is `200 { "snapshot": ... }`. Calling close again always returns original v1, even after subsequent adjustments. There is no automatic calendar cutoff, source-completeness gate, or authorization check.

`POST /api/adjust` with `{ "expected_version": 1 }` creates or recovers version 2. The supplied base version is also the operation's retry identity. If that operation's resulting snapshot already exists, the API returns it even when newer versions exist. Otherwise a noncurrent base version returns `409 VERSION_CONFLICT`. On an ambiguous failure, retry with the same base version; changing it can start a different operation.

Both operations first reserve a durable build and advance the ingestion epoch, then read the fixed ledger range and publish the snapshot atomically with its latest-version pointer. `phase: "CLOSED"` can therefore coexist with an unfinished build and no v1 yet. Consume an actually published snapshot, not the phase flag alone. A recovery finishes the same reserved range; events beyond that range remain pending. A build left unfinished by the older safe-integer overflow check can finish through the same close or adjustment request after updating the code. No build reset, fence rollback or rewrite of prior snapshots is required. This does not repair a snapshot too large for DynamoDB or a workload that persistently exceeds the execution timeout.

Snapshots are cumulative totals. `event_ids` identifies their complete membership; `added_event_ids` identifies additions relative to the prior version. An adjusted snapshot is not a command to charge its cumulative amount again. Downstream systems must track the version they already consumed and decide how to handle the difference. Current adjustments only add accepted positive usage; no negative correction, reversal, invoice or payment is implemented. The recorded/live UI does not issue adjustments; the API does not reject an empty-delta adjustment.

## Period view and processing status

`GET /api/period` returns period state, immutable snapshots, accepted events, observed processing receipts, the ON_TIME aggregate and pending usage. It reads these separately, with pagination where required; **the whole response is not a snapshot of one instant**.

- `latest_version` is the latest snapshot observed in this response, not a guarantee of the global latest version at response delivery.
- `pending` is the returned POST_CLOSE events absent from that observed snapshot. If v2 publishes after v1 was read, a response displaying v1 may still show usage as pending relative to v1.
- `phase`, `epoch`, `building`, receipts and aggregates can temporarily reflect different points during concurrent work. Refresh after concurrent activity; mutation endpoints still enforce their own conditions.
- Each published snapshot and its saved membership remains fixed. Display inconsistency does not authorize changing it.

The aggregate covers only ON_TIME events. Compare it with ON_TIME ledger usage, not the total including POST_CLOSE usage. A difference or missing receipt indicates that processing was not reflected in the observed reads; it may also arise from separate reads during concurrent activity. It does not diagnose ordinary delay, consumer failure or expired delivery records, or prove processing is still incomplete at response delivery. DynamoDB Streams has a 24-hour retention window. The deployed AWS path has no automatic alert, replay from the ledger or aggregate repair. The ordinary local worker polls its default ledger namespace and retries processing; isolated local scenario runs instead control deliveries explicitly. Local polling is not a deployed recovery guarantee. Ledger-derived snapshots do not require that projection to catch up.

`GET /api/health` reports that the handler responds and labels its environment. It does not check source completeness, permissions, database readiness, consumer health or projection freshness. The local runner additionally advertises `demo: true`; deployed handlers do not. Local `/api/demo` routes are outside the deployed API.

## Errors and retries

| Status | Caller handling |
| --- | --- |
| `400` | Correct malformed JSON, event fields, timestamp, units or expected version |
| `409` | Inspect payload/version conflict; preserve the original event; refresh before intentionally requesting a new operation |
| `413` | Request body exceeds 16,384 bytes |
| `503` | Use bounded retries with the same event ID/payload, close, or adjustment base version; response includes `Retry-After: 1`. Investigate persistent failure. |
| `500`, network failure, lost response | Completion may be ambiguous; use the same operation identity with bounded retries and investigate persistent failure |

Retries are not an approval workflow. An authorized business decision and a technically idempotent request are different controls; only the latter is implemented here. Durable build state supports recovery from an interruption or transient failure; it does not guarantee that every failed operation will eventually succeed. Storage item-size limits, persistent execution-time limits and other unresolved failures require investigation. There is no automatic build cancellation, rollback or manual-unlock API; deleting a build record or changing its epoch is not a supported recovery procedure.

Implementation: `src/domain.ts`, `src/store.ts`, `src/api.ts`. AWS delivery retention: [DynamoDB Streams documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html).
