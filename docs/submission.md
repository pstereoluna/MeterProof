# Builder Center update draft

**Editorial status: draft only; not posted.** The recorded walkthrough is implemented and verified locally. AWS deployment is awaiting renewal of the expired login; do not describe this update as live yet. The earlier AWS deployment and cloud smoke are independently documented.

Target project: [MeterProof — Explain every change in reported usage](https://builder.aws.com/project/3JzE9LF8ZJamr5T1eQDm6uNGngR/meterproof-explain-every-change-in-reported-usage).

## Proposed update

### Explain the next 100 units without rewriting the first 750

MeterProof preserves closed usage reports and explains later adjustments before billing consumes the numbers. The target reader is a SaaS engineer or finance operator investigating a familiar question: September closed at 750 units; another 100 arrived later. Why is the latest estimate different, and did the original report change?

I built a six-step, read-only recorded AWS walkthrough: **accept → close → late usage → retry → adjust → verify**. It follows the actual deployed sequence from a $7.50 original snapshot, through +$1.00 of pending usage, to an $8.50 adjusted snapshot. Visitors will be able to revisit the explanation without submitting new usage or resetting shared history. A separate **View live record** action reads the current deployed state.

The walkthrough passed 26 automated tests and 29 browser assertions locally; its deployment is awaiting renewed AWS authentication. Its underlying evidence is real: the September 30 Pacific / October 1 UTC cloud smoke of source commit `819c512` preserved both snapshots, rejected conflicting event-ID reuse, and observed all four processing receipts through DynamoDB Streams. Early views reconstructed from successful replies are labeled, and an unobserved aggregate is not displayed as zero.

The boundaries matter. Stronger lag, race and interruption exercises run against DynamoDB Local; the cloud smoke did not force a race or Lambda crash. Amounts are estimated usage charges, not invoices or payments. The ledger is authoritative for accepted reports, not independent proof that all real usage was reported.

Codex helped implement and review the transactions, connect through browser AWS sign-in, and execute STS, CLI and CDK verification. No AWS MCP connection is verified. The walkthrough adds no AWS services or runtime AI.

Existing metering and billing products already serve this problem space. This project is a focused reference implementation of cutoff guarantees. My adoption hypothesis is that an event-level explanation of preserved versions helps an engineer and finance operator resolve a usage discrepancy. I have not yet validated that hypothesis with customer use or interviews.

[Source](https://github.com/pstereoluna/MeterProof/tree/main/src) · [Tests](https://github.com/pstereoluna/MeterProof/tree/main/test) · [Cloud evidence and limits](https://github.com/pstereoluna/MeterProof/blob/main/evidence/cloud-verification.md) · [Local scenario evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/scenario-verification.md)

## Before publishing this update

Replace the pending-status sentences only after the new route and both recorded/live UI paths have been verified and deployed. Add the actual verification record and release revision. Keep the source-run provenance and local/cloud proof distinctions. This draft does not claim eligibility or final submission, market traction, commercial uniqueness, or an MCP connection. No external project edit or cover-image creation is part of this document change.
