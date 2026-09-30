# Evidence status

| Evidence | Status |
| --- | --- |
| Coding agent implementation and review | Completed; see development log and source |
| Local DynamoDB transaction verification | Executed; see local verification record |
| Combined local scenario and restart recovery | Executed; [22 tests and 46 browser-observed checks](scenario-verification.md) |
| CDK synthesis and real Lambda bundling | Executed locally |
| Review closeout: policy, API contract and both UI modes | [Verified locally; 22 tests passed](review-closeout.md) |
| Authenticated coding-agent-to-AWS connection | **Pending** — local-only milestone selected by user |
| Deployment and cloud end-to-end smoke test | **Pending** |
| Hackathon eligibility / submission | Not independently verified or submitted |

Do not present local synthesis or DynamoDB Local as a cloud deployment. When the user selects an AWS target, Codex can run `EVIDENCE_ACTOR=Codex npm run evidence:aws` with explicit `AWS_PROFILE` and `AWS_REGION`. The script records a sanitized read-only STS result, including failure if verification fails. Generated identity evidence is git-ignored for review before any public submission.

For stronger submission evidence, preserve the actual deployment output, deployed API URL, CloudFormation completion, Lambda logs and a cloud smoke transcript showing both snapshots and their immutable event membership. Redact account identifiers and any credentials. Keep failed attempts honestly labeled. No AWS credentials are stored in this repository.

The [cloud verification runbook](../docs/cloud-verification.md) is prepared but not executed. The [operating policy](../docs/operating-policy.md) defines demonstration responsibilities; it does not implement identity, approval or source-completeness controls.
