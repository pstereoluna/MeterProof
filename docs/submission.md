# Builder Center project copy

**Draft for the existing project page; not published automatically.** The walkthrough is deployed and verified. [Verification record](../evidence/walkthrough-verification.md).

Target: [existing Builder Center project](https://builder.aws.com/project/3JzE9LF8ZJamr5T1eQDm6uNGngR/meterproof-explain-every-change-in-reported-usage).

## Title

MeterProof — Explain every change in reported usage

## Description

A serverless usage-metering demo that preserves closed usage snapshots and makes later adjustments explicit. Follow recorded AWS evidence from a $7.50 original snapshot to an $8.50 adjusted result, with event-level derivation and the original still intact.

## Body

### September closed at $7.50. Why is the latest estimate $8.50?

A usage report can arrive late. A client can retry a request. An asynchronous consumer can process an accepted event after the period closes. Those situations should not silently change a report that downstream billing already consumed.

MeterProof explores this problem for a SaaS engineer and finance operator investigating a usage discrepancy. It preserves the original report and explains each later version through the accepted events that produced it.

### Try the walkthrough

[Open MeterProof](https://iqqd5bi25e.execute-api.us-east-1.amazonaws.com/). The six-step recorded AWS walkthrough follows acceptance, close, late usage, retries, adjustment and verification:

1. Three events contribute 750 units, or $7.50 in estimated usage charges.
2. Closing the period preserves snapshot v1.
3. A September event accepted after close adds 100 units as an explicit pending adjustment.
4. An identical retry returns the original accepted event. Reusing its ID with a different payload returns HTTP 409.
5. Snapshot v2 includes the additional $1.00, reaching $8.50.
6. Snapshot v1 still contains its original three events and $7.50 total.

Visitors can go back, restart and inspect saved requests and responses without changing shared data. **View live record** separately reads the current API state. The walkthrough is clearly labeled as a recording; early views reconstructed from successful responses identify unobserved processing values.

### The control behind the numbers

Cutoff is decided by an ingestion transaction competing with a stored period boundary, not by the asynchronous consumer's processing time. The accepted-event ledger is authoritative. The open-period aggregate is a fast materialized view; closing derives snapshot membership from the ledger. An adjustment publishes a new snapshot while preserving its predecessor.

The implementation uses API Gateway, Lambda, DynamoDB and DynamoDB Streams, deployed through AWS CDK. It keeps three times distinct: source-reported occurrence, a server acceptance-time sample, and the processing receipt.

### What was verified

The historical AWS run demonstrated ingestion, idempotent retries, conflict rejection, preserved snapshots and real Streams receipts. The new public walkthrough passed 30 browser assertions across two independent visitors and desktop/mobile layouts. Eleven read-only cloud checks confirmed the deployed artifacts and an unchanged live period. The repository also passes 26 automated tests. Controlled lag, concurrency and interruption/recovery exercises run locally against DynamoDB Local.

Codex helped implement, review, verify and deploy the project. The documented AWS connection used browser sign-in, STS, AWS CLI and CDK. No AWS MCP connection is claimed.

MeterProof reports estimated usage charges; it does not issue invoices or move money. The demo has no authentication or approval workflow, and accepted reports do not independently prove source truth or completeness. Existing metering and billing products already serve this market. This project is a focused reference implementation of cutoff guarantees; its usefulness to the target users remains a hypothesis awaiting user feedback.

[GitHub repository](https://github.com/pstereoluna/MeterProof) · [Latest verification](https://github.com/pstereoluna/MeterProof/blob/main/evidence/walkthrough-verification.md) · [Original AWS evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/cloud-verification.md) · [Local scenario evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/scenario-verification.md)
