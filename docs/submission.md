# Builder Center project copy

**Published to the existing Builder Center project on October 2, 2026.** The platform displayed its publication-success notification. The user confirmed that the competition submission had already been made. See the [latest verification](../evidence/release-2026-10-02.md).

Target: [existing Builder Center project](https://builder.aws.com/project/3JzE9LF8ZJamr5T1eQDm6uNGngR/meterproof-explain-every-change-in-reported-usage).

## Title

MeterProof: Explain Every Change in Reported Usage

## Description

A serverless usage-metering demo that preserves closed usage snapshots and makes later adjustments explicit. Follow recorded AWS evidence from a $7.50 original snapshot to an $8.50 adjusted result, with event-level derivation and the original still intact.

## Body

### September closed at $7.50. Why is the latest estimate $8.50?

A usage report can arrive late. A client can retry a request. An asynchronous consumer can process an accepted event after the period closes. Those situations should not silently change a report that downstream billing already consumed.

MeterProof explores this problem for a SaaS engineer and finance operator investigating a usage discrepancy. It preserves the original report and explains each later version through the accepted events that produced it.

### Try the walkthrough

[Open MeterProof](https://iqqd5bi25e.execute-api.us-east-1.amazonaws.com/). The six-step recorded AWS walkthrough follows acceptance, close, late usage, retries, adjustment and verification:

1. Three event cards combine into 750 units, or $7.50 in estimated usage charges.
2. Closing places those three members into a saved v1 snapshot at $7.50.
3. A September event accepted after close appears outside v1: +100 units / +$1.00 awaiting adjustment.
4. Compare two retries: the identical 100-unit report returns the original event; changing the same ID to 101 units returns HTTP 409. Neither adds usage.
5. The original $7.50 plus the late $1.00 produces a separate v2 at $8.50, leaving no pending usage.
6. Compare v1 at close with v1 after adjustment: the same three events and $7.50 total remain beside v2.

Each step shows the action and its result before the detailed evidence. Visitors can go back, restart and expand the ledger, derivations, saved requests and checks without changing shared data. A secondary [current AWS record](https://iqqd5bi25e.execute-api.us-east-1.amazonaws.com/?view=live) link separately reads the API state. The walkthrough remains visibly labeled as a recording; early views reconstructed from successful responses identify unobserved processing values. The final comparison verifies preservation rather than claiming another state change.

### The control behind the numbers

Cutoff is decided by an ingestion transaction competing with a stored period boundary, not by the asynchronous consumer's processing time. The accepted-event ledger is authoritative. The open-period aggregate is a fast materialized view; closing derives snapshot membership from the ledger. An adjustment publishes a new snapshot while preserving its predecessor.

The implementation uses API Gateway, Lambda, DynamoDB and DynamoDB Streams, deployed through AWS CDK. It keeps three times distinct: source-reported occurrence, a server acceptance-time sample, and the processing receipt.

### What was verified

The historical AWS run demonstrated ingestion, idempotent retries, conflict rejection, preserved snapshots and real Streams receipts. The October 2 release passed 36 automated tests, 36 public-browser assertions across independent visitors and desktop/mobile layouts, and 17 read-only cloud checks. Both deployed Lambda code bundles matched the tested artifacts, and the original live period remained unchanged. Controlled lag, concurrency and interruption/recovery exercises run locally against DynamoDB Local.

An independent review also identified a numeric boundary that could prevent a snapshot build from completing. The fix calculates totals exactly and lets an unfinished build resume its original cutoff boundary; earlier snapshots remain intact. Large-total and recovery cases were verified locally, including the generated Lambda bundle, without injecting large usage into the shared AWS demonstration.

Codex helped implement, review, verify and deploy the project. The documented AWS connection used browser sign-in, STS, AWS CLI and CDK. No AWS MCP connection is claimed.

MeterProof reports estimated usage charges; it does not issue invoices or move money. The demo has no authentication or approval workflow, and accepted reports do not independently prove source truth or completeness. Existing metering and billing products already serve this market. This project is a focused reference implementation of cutoff guarantees; its usefulness to the target users remains a hypothesis awaiting user feedback.

[GitHub repository](https://github.com/pstereoluna/MeterProof) · [Latest verification](https://github.com/pstereoluna/MeterProof/blob/main/evidence/release-2026-10-02.md) · [Original AWS evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/cloud-verification.md) · [Local scenario evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/scenario-verification.md)

Category: Commercial Potential
Track: Startup
