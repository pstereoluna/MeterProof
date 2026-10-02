# Evidence status

| Evidence | Status |
| --- | --- |
| Coding agent implementation and review | Completed; see development log and source |
| Local DynamoDB transaction verification | Executed; see local verification record |
| Combined local scenario and restart recovery | Executed; [22 tests and 46 browser-observed checks](scenario-verification.md) |
| CDK synthesis and real Lambda bundling | Executed locally |
| Review closeout: policy, API contract and both UI modes | [Verified locally; 22 tests passed](review-closeout.md) |
| Authenticated coding-agent-to-AWS connection | **Verified by Codex** on September 30, 2026; sanitized identity record retained privately |
| Deployment and cloud end-to-end smoke test | **Passed** — [29 infrastructure assertions, 33 API/data assertions, real Streams receipts](cloud-verification.md) |
| Recorded AWS walkthrough update | **Deployed and verified**; 26 tests, 30 public-browser assertions, 11 read-only cloud checks — [executed verification](walkthrough-verification.md) · [scope and provenance](../docs/demo-walkthrough.md) |
| Visual action/result scenes | **Deployed and verified** — 26 tests, 36 public-browser assertions, 11 cloud checks; [latest results](visual-scenes-verification.md) |
| Builder Center project | [Project page exists](https://builder.aws.com/project/3JzE9LF8ZJamr5T1eQDm6uNGngR/meterproof-explain-every-change-in-reported-usage); proposed walkthrough update is an unpublished [draft](../docs/submission.md) |
| Hackathon eligibility / final submission | Not independently verified; an existing project page alone does not establish eligibility or final submission |

Do not present local synthesis or DynamoDB Local as a cloud deployment. When the user selects an AWS target, Codex can run `EVIDENCE_ACTOR=Codex npm run evidence:aws` with explicit `AWS_PROFILE` and `AWS_REGION`. The script records a sanitized read-only STS result, including failure if verification fails. Generated identity evidence is git-ignored for review before any public submission.

For stronger submission evidence, preserve the actual deployment output, deployed API URL, CloudFormation completion, Lambda logs and a cloud smoke transcript showing both snapshots and their immutable event membership. Redact account identifiers and any credentials. Keep failed attempts honestly labeled. No AWS credentials are stored in this repository.

The [cloud verification runbook](../docs/cloud-verification.md) was used for the September 30 cloud verification; the linked evidence describes what actually ran and what remains untested. The [operating policy](../docs/operating-policy.md) defines demonstration responsibilities; it does not implement identity, approval or source-completeness controls.

The recorded walkthrough uses sanitized API evidence from application commit [`819c512`](https://github.com/pstereoluna/MeterProof/tree/819c512), observed on September 30 Pacific / October 1 UTC. A reconstructed early view is labeled and does not invent an aggregate observation. Reading or replaying this artifact is not a new AWS smoke run; the separate live-record view is a current observation with its own limitations. Existing historical evidence is preserved as executed.

The verified coding-agent connection path was browser AWS sign-in followed by STS, AWS CLI and CDK operations. **No AWS MCP connection is verified.** The [public source](https://github.com/pstereoluna/MeterProof/tree/main/src), [tests](https://github.com/pstereoluna/MeterProof/tree/main/test) and [cloud evidence](https://github.com/pstereoluna/MeterProof/blob/main/evidence/cloud-verification.md) expose implementation and proof boundaries without claiming user traction or production readiness.
