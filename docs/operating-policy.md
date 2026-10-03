# Operating policy for the controlled MeterProof demo

This policy describes how to operate the synthetic **ACME · September 2026** demonstration. The rate is fixed at one cent per unit. Its outputs are preserved usage snapshots and estimated charges, with event membership explaining each total. They are not invoices, payment instructions, or accounting entries.

**Role names below assign human responsibilities for the demonstration. The application does not authenticate these roles, require approval, or record who performed an action. This document does not create those controls.** One demonstrator may perform several roles, but should identify which responsibility each action represents. ACME is a fictional usage subject, not a real customer agreement.

## Responsibility and control matrix

| Role | Human responsibility in this demo | Code control and its boundary |
| --- | --- | --- |
| Producer | Supply the agreed synthetic event IDs, occurrence times and positive quantities. Retry an uncertain submission with the same ID and payload. Explain which fixture events are deliberately held back until after close. | Input validation and conditional event-ID claims reject invalid inputs and conflicting reuse. They do not prove that usage happened, find unreported usage, or identify the same real usage submitted under different IDs. |
| Demonstration operator / billing owner | Confirm the intended pre-close fixture is accepted, choose when to close, inspect pending usage, and explicitly request the next adjustment. Decide whether an output is ready to be discussed with a downstream consumer. | Close and adjustment preserve snapshots and enforce transaction boundaries. No calendar deadline, source-completeness gate, business approval, or automatic adjustment is enforced. |
| MeterProof operator | Run the selected local target, preserve its data and checkpoint, inspect failures, and retry the same interrupted operation. Keep delivery simulation distinct from actual AWS execution. | Durable build state and idempotent transactions support recovery. The local scenario serializes its own requests and isolates runs. These are technical safeguards, not an authorization or actor-audit system. |
| Customer, represented by ACME | In the narrative, inspect the event derivation and ask why a later snapshot differs. The demonstrator explains this perspective; no real customer action is required. | ACME is fixed in code. There is no customer account, customer consent, dispute workflow, or customer approval of adjustments. |
| Downstream billing / accounting owner | In the narrative, decide how an explicitly identified usage snapshot or change would be treated under that downstream system's rules. | No downstream connector, invoice modification, charge, refund, or accounting treatment is implemented. Publishing a snapshot does not perform a financial action. |

## What determines the cutoff

`occurred_at` identifies the producer-reported usage time. This MVP accepts valid UTC timestamps within September 2026; it does not route other periods or verify the producer's clock. An older occurrence time does not make an event ON_TIME after the period closes.

Acceptance is the successful ingestion transaction: it checks the observed period phase and epoch, appends the event, and claims its ID together. Closing reserves a durable fence and advances the epoch. Whichever operation succeeds first determines membership. A losing ingestion attempt rereads and retries against the new state. `accepted_at` is a server sample taken before that transaction attempt, not an exact database commit timestamp; comparing timestamps is not the cutoff rule.

`processed_at` records the first successful asynchronous processing receipt. Processing after close does not change an accepted event's classification. Close derives its snapshot from the ledger through the reserved fence, regardless of whether the ON_TIME projection has caught up. The authoritative ledger covers accepted inputs; it does not certify complete real-world usage.

## Procedure for a controlled run

1. **Use synthetic data and identify the run.** For the local eight-step scenario, use its isolated run namespace. Run only one local server process against that target's scenario checkpoint. Use **New run** to repeat the demonstration while preserving prior data.
2. **Check the intended pre-close source set.** Confirm `evt_001` = 100, `evt_002` = 250 and `evt_003` = 400 are accepted in the ledger with the intended payloads. If a request's outcome is uncertain, retry its unchanged ID and payload. This is a human check against the known fixture, not an implemented completeness certification. The later fixture events are deliberately withheld and disclosed as such.
3. **Separate source completeness from processing lag.** All three events can be accepted while only the first two have receipts: ledger 750, ON_TIME projection 350. That lag is not a missing source event and does not require waiting before this demo's close. Conversely, a caught-up projection does not establish that the producer submitted all intended usage.
4. **Close explicitly.** The operator invokes close only after the intended pre-close fixture check. There is no automatic month-end close, scheduled deadline, or approval threshold. The demo can run on any calendar date. The resulting v1 must contain all three accepted events and total 750 units / $7.50.
5. **Expose every accepted positive post-close event as pending.** Such events keep their occurrence times and receive POST_CLOSE classification. Until included in a published snapshot, they remain visible as pending usage. The demo has no amount threshold, automatic billing, event-by-event approval, or selective exclusion from adjustment.
6. **Adjust explicitly with the observed version.** Inspect the event IDs and pending quantities, then request adjustment using the latest observed snapshot's `expected_version`. The operation includes all accepted usage through its newly reserved fence. It creates a new version and preserves earlier versions. Usage accepted beyond that fence remains pending for another explicit adjustment.

The screen is an observation of several reads, not a transactionally synchronized balance. Pending means returned POST_CLOSE events outside the latest snapshot returned in that response. Refresh after competing activity; do not interpret an old screen as proof that no newer snapshot exists. The mutation endpoints retain their own conditional controls.

## Retries, interruptions and incorrect inputs

For an uncertain close, repeat close; it creates or recovers the original v1 and returns v1 on subsequent retries. For an uncertain adjustment, repeat the **same `expected_version`**. It identifies the same operation and returns its result if already published, even if later versions now exist. Do not change the version merely because a response was lost. For an uncertain ingestion, keep both the original ID and payload.

Use bounded retries and inspect persistent failure. An interrupted or transiently failed build can resume its saved fence; retries do not guarantee success for a snapshot exceeding DynamoDB's item limit or a workload that cannot complete within the execution timeout. There is no automatic failure escalation, cancellation or manual-unlock API. Do not delete `building`, reset the period or roll back the epoch to make an error disappear: these fields preserve the membership boundary and operation identity.

Totals now use exact integer arithmetic. A build left unfinished by the older safe-integer overflow check can resume after updating the code by repeating close or the same adjustment base version; no ledger edit or build reset is needed. Previously published snapshots stay unchanged. Snapshot, aggregate and pending `units` / `amount_cents` remain JSON numbers within the safe range and become canonical nonnegative decimal strings above it. Keep those strings exact when exporting or inspecting responses; do not convert them to JavaScript `Number`. The UI displays them with exact integer formatting. This changes neither the positive safe-number event input rule nor the normal $7.50 / $8.50 fixture, and it adds no usage quota or new approval threshold.

In the local scenario, step 5 deliberately throws after reserving v2's fence and accepting a further 50 units beyond it. Step 6 recovers that same operation using `expected_version: 1`; v2 contains 1,050 units and leaves the newer 50 pending. Step 7 uses `expected_version: 2` to publish v3 at 1,100 units. This is an injected interruption around real DynamoDB Local transactions, not evidence of an actual AWS Lambda process crash. Scenario progress retries also retain their run ID and expected step.

An event-ID payload mismatch is rejected with a domain/API conflict rather than overwriting the accepted event. Zero and negative quantities are rejected. This MVP has no quantity correction, cancellation, reversal, refund, or negative adjustment mechanism. A new ID with a positive quantity would add usage, not correct the old event. If a synthetic fixture was wrong, stop presenting that run as a valid example and use a new isolated run with the correct fixture; preserve the earlier run rather than rewriting its history.

## Example of the value being demonstrated

Imagine a provider explaining ACME's usage estimate. All 750 units reached MeterProof before close, but the processor still shows only 350. The provider can nevertheless preserve and explain a $7.50 snapshot from the accepted ledger. Later, a previously withheld 100-unit September event arrives. The original $7.50 remains reproducible; the extra $1.00 appears explicitly pending. The operator then publishes v2 at $8.50, with the added event identified. The customer-facing explanation is concrete: the input set grew after the first snapshot. Any decision to collect that additional amount belongs downstream and is not performed here.

This demonstrates reproducible treatment of accepted usage across close, retries and later arrivals. It does not establish that the underlying usage was true or complete, or that a customer owes the displayed estimate.

## Production requirements that remain unimplemented

Before using a similar workflow with real customers, its owners would need to define and enforce identity and tenant access, authority to close and adjust, approval responsibilities, attributable action records, source reconciliation, treatment of bad or missing inputs, supported corrections, and downstream billing rules. None is supplied by this policy or the current role labels. No real cutoff schedule, contractual rule, financial approval threshold, or new infrastructure is introduced here.

Operational recovery also has limits. The deployed stream can expire unprocessed records; retries do not provide an unlimited delivery history. The ledger can still support correct snapshots, while the projection may remain incomplete without repair. Both the basic and local scenario screens expose ON_TIME ledger/projection differences. Separate reads can also cause temporary differences. This comparison does not supply automatic alerting, repair or diagnosis of stream expiry. The ordinary local polling worker retries ledger processing; the deployed AWS path has no equivalent ledger replay. Application conditional writes preserve history along the intended code path, but privileged database administrators are not prevented from changing data and no cryptographic tamper proof is claimed.

## Implementation basis

These descriptions follow `src/domain.ts` (`validateInput`, `ingest`, `close`, `adjust`, `finishBuild`, `view`), `src/store.ts` (conditional acceptance, fencing, snapshot publication and processing transactions), and `src/api.ts` (HTTP behavior). Local isolation, checkpoint handling and the injected scenario are in `scripts/local.ts` and `scripts/scenario.ts`. The comparison panel is in `web/index.html`. See [architecture](architecture.md) and [the local scenario](scenario.md) for technical details and verification boundaries.
