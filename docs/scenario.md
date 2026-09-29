# Eight-step local correctness demonstration

The local page now tells one continuous story: processing lags, an event is retried across close, old usage arrives later, an adjustment is interrupted, and the same operation is recovered. The displayed balances come from actual DynamoDB Local reads and transactions through the existing MeterProof domain and store.

| Step | Action | Observable result |
| --- | --- | --- |
| 1 | Accept 100, 250 and 400 units; deliver only the first two to metering | Ledger 750, ON_TIME projection 350, evt_003 lacks a receipt |
| 2 | Close while the projection is behind | Immutable v1 = 750 / $7.50, including evt_003; projection still 350 |
| 3 | Retry evt_003 ingestion five times and deliver it to metering five times | Three ledger events, projection 750, no adjustment; original acceptance/classification retained |
| 4 | Accept evt_004 = 100 and evt_005 = 200 with older occurrence timestamps | v1 preserved, +300 / +$3.00 pending |
| 5 | Reserve v2, accept evt_006 = 50 beyond its fence, then inject an interruption | Only v1 is published; durable v2 build remains; 350 units not yet in a published adjustment |
| 6 | Recover using a fresh domain-service instance | v2 = 1,050 / $10.50; only evt_004 and evt_005 added; 50 / $0.50 remains pending |
| 7 | Create the next adjustment | v3 = 1,100 / $11.00; only evt_006 added; v1 and v2 preserved |
| 8 | Retry evt_004 with 150 units instead of its original 100 | Domain idempotency conflict 409; event and snapshots unchanged |

Step 5 injects a deliberate exception after a real durable fence. It demonstrates recovery from interrupted execution, **not an actual AWS Lambda process crash**. Step 8 captures the domain conflict for the evidence panel; the scenario-control HTTP request itself succeeds because the expected rejection was verified.

## Use the screen

Start DynamoDB Local and the app as described in the README. The local server advertises `demo: true` through health. The page shows the next action, the recorded evidence for completed steps, ledger and projection values, pending adjustments and snapshot versions. Advance one step at a time. Select earlier snapshot versions to inspect their unchanged event membership. Expand an event to see producer, acceptance and processing timestamps.

The local controller checks actual results against each step's expected invariants before advancing. The interface shows the returned evidence; a failed invariant reports an error and keeps the step pending. Displayed timestamps are real server samples, except producer occurrence timestamps, which are fixed September fixtures.

## Repeat and resume

“New run” creates a new namespace in the same two local tables. It does not delete prior events or snapshots. Each namespace is `DEMO#<run UUID>#CUSTOMER#ACME#PERIOD#2026-09`; original demonstration records keep their original namespace.

The active run, completed step count and evidence are saved atomically in `.local/scenario-<target hash>.json`. The target hash distinguishes database endpoints and table names. Restarting the local server with the same target resumes the same run. Repeating a step request with the same run ID and expected step acknowledges completed work; it does not execute the next step. If a checkpoint write fails, the prior checkpoint remains active and the same idempotent domain operations can be retried.

Only one local server process should drive a target's scenario checkpoint at a time. The controller serializes requests within that process. Checkpoint files contain local demonstration metadata, not cloud execution evidence.

## Product and deployment boundary

- The local scenario controller and its three routes are in `scripts/`, outside Lambda entry points. They are not deployed or exposed by API Gateway.
- DynamoDB Streams remains the deployed asynchronous path. Local scenarios deliberately control delivery to make timing reproducible; they do not pause or replace an AWS event-source mapping.
- The normal local worker reads only the original namespace. It never processes withheld scenario records automatically.
- The projection counts only ON_TIME events. After it catches up to 750, later POST_CLOSE usage does not raise it; the ledger and immutable snapshots account for that usage. A ledger total of 1,100 alongside an ON_TIME projection of 750 is not 350 units of projection lag.
- A fourth optional store-constructor argument scopes local run keys. The default remains the original customer/period partition, so deployed callers keep the existing behavior.
- AWS continues to serve the basic four-event screen until an explicitly designed cloud-safe demonstration is implemented. No additional AWS services, product features or cloud deployment are part of this change.
