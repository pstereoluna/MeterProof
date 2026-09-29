# Evidence status

| Evidence | Status |
| --- | --- |
| Coding agent implementation and review | Completed; see development log and source |
| Local DynamoDB transaction verification | Executed; see local verification record |
| CDK synthesis and real Lambda bundling | Executed locally |
| Authenticated coding-agent-to-AWS connection | **Pending** — local-only milestone selected by user |
| Deployment and cloud end-to-end smoke test | **Pending** |
| Hackathon eligibility / submission | Not independently verified or submitted |

Do not present local synthesis or DynamoDB Local as a cloud deployment. When the user selects an AWS target, Codex can run `EVIDENCE_ACTOR=Codex npm run evidence:aws` with explicit `AWS_PROFILE` and `AWS_REGION`. The script records a sanitized read-only STS result, including failure if verification fails. Generated identity evidence is git-ignored for review before any public submission.

For stronger submission evidence, preserve the actual deployment output, deployed API URL, CloudFormation completion, Lambda logs and a cloud smoke transcript showing both snapshots and their immutable event membership. Redact account identifiers and any credentials. Keep failed attempts honestly labeled. No AWS credentials are stored in this repository.
