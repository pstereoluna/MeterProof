# Recorded AWS walkthrough

**Status: local verification passed. AWS deployment is pending reauthentication.** The underlying application was deployed and smoke-tested previously; this new presentation has been verified locally and is awaiting deployment. [Historical evidence](../evidence/cloud-verification.md) remains unchanged.

The walkthrough follows one question: **September usage closed at 750 units. Another 100 units arrived later. Why is the latest estimate 850, and did the original change?** A SaaS engineer and finance operator can inspect the accepted events and both snapshots to answer it. This is a target-user hypothesis, not evidence of customer adoption.

## Six recorded steps

| Step | What the visitor inspects | What the historical AWS evidence supports |
| --- | --- | --- |
| Accept | Three accepted events: 100 + 250 + 400 units | Successful ingestion replies and original acceptance/classification; unobserved early projection values are not invented |
| Close | Original v1: 750 units / $7.50 estimated charge | Published snapshot membership and the captured closed-period response |
| Late usage | Another September event: +100 units / +$1.00 pending | POST_CLOSE classification despite its older occurrence time, with v1 unchanged |
| Retry | Identical retry, changed-payload rejection and original close result | The accepted event is returned unchanged; conflicting ID reuse produces `IDEMPOTENCY_MISMATCH`; close returns v1 |
| Adjust | v2: 850 units / $8.50 estimated charge | Cumulative membership adds only the 100-unit event; prior v1 is preserved |
| Verify | Saved retry results, final period and processing receipts | Two preserved snapshots, no pending usage, all four real processing receipts, and ON_TIME projection 750 rather than 850 |

The updated public default loads `GET /api/replay`. Step navigation only changes the displayed recorded step. Replaying the explanation does not submit another event, call close/adjust, rerun the cloud verification, or reset a shared ledger. Existing public mutation endpoints remain unauthenticated; a read-only viewer is not an access-control mechanism.

## Provenance and honest presentation

The source is the real cloud API sequence executed from commit [`819c512`](https://github.com/pstereoluna/MeterProof/tree/819c512) on **September 30, 2026, America/Los_Angeles**, at **2026-10-01 04:03:42–04:03:48 UTC**. These are the same evening. Recorded request/response evidence is sanitized before being exposed publicly; the private deployment transcript remains separate.

Full period captures are used where available. Earlier display views reconstructed from successful API replies are labeled as reconstructions, rather than presented as additional captured `GET /api/period` responses. Their aggregate is `null` / **not observed** when no aggregate observation exists. A missing observation is not zero usage, proof of processing lag, or proof of lost delivery.

The timestamps remain the server observations recorded during that run. `accepted_at` is a pre-transaction clock sample; `processed_at` belongs to the first successful processing receipt. Neither is an exact commit timestamp or a substitute for stored cutoff classification and snapshot membership.

## Recorded, live and local are separate

| Mode | Source | Meaning |
| --- | --- | --- |
| Recorded AWS walkthrough | Sanitized historical requests/responses from the verified run | Inspect a repeatable explanation without new metering writes; does not establish current service health |
| View live record | Current `GET /api/period` from the deployed application | Inspect today's saved record; separate reads may briefly differ during concurrent work |
| Local eight-step scenario | Real DynamoDB Local transactions with controlled delivery and an injected interruption | Exercise local retry, cutoff and recovery behavior; not evidence of a forced AWS race or Lambda crash |

The original cloud smoke observed real Streams processing. It did not deliberately cause cloud processing lag, ingestion/close races, redelivery, or a Lambda crash. The local simulator remains unchanged and its stronger fault exercises retain their local label. No AWS services are added for the walkthrough.

## Review the implementation and evidence

- [Public source](https://github.com/pstereoluna/MeterProof/tree/main/src)
- [Domain, infrastructure and integration tests](https://github.com/pstereoluna/MeterProof/tree/main/test)
- [Executed cloud verification and limits](https://github.com/pstereoluna/MeterProof/blob/main/evidence/cloud-verification.md)
- [Local scenario evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/scenario-verification.md)
- [API semantics](api-contract.md) and [human responsibilities](operating-policy.md)

Metering and billing competitors already exist. This demonstration is a reference implementation of explicit cutoff and preservation guarantees. It does not validate source truth or completeness, authorize charges, implement corrections, or establish commercial uniqueness.
