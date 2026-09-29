# Combined scenario verification

Executed by Codex on 2026-09-29 using the desktop project at `/Users/algernon/Desktop/MeterProof`.

## Automated checks

- `npm run check` passed: TypeScript checking, 13 unit/infrastructure tests, CDK synthesis and Lambda asset bundling.
- `npm run test:integration` passed: 9 integration tests against DynamoDB Local, including the complete eight-step scenario, concurrent repeated steps, independent run namespaces, and recovery when saving the scenario checkpoint fails after an interrupted adjustment.
- After the final interface wording changes, `npm run synth` and the synthesized-bundle integration test passed again. The deployed handler returns 404 for local scenario routes and does not advertise `demo: true`.
- `git diff --check` passed.

Total: **22 automated tests passed, 0 failed**. Re-running the bundle test is additional verification, not an additional distinct test.

## Browser verification

Operated the local screen at `http://127.0.0.1:3000/` through all eight steps. Run `70e99db1-a23e-4415-8c48-82a525a3bfb1` recorded **46 invariant checks, 46 passed, 0 failed**.

| Observed state | Result |
| --- | --- |
| Delivery held for evt_003 | Ledger 750 units, ON_TIME projection 350 units |
| Close before delivery catches up | v1 includes all 750 units / $7.50 |
| Five ingestion retries and five processing deliveries | Three ledger events, projection 750; evt_003 still ON_TIME |
| Older usage accepted after close | +300 units pending; v1 preserved |
| Injected interruption after reserving v2, then another 50 units accepted beyond its fence | Only v1 published; durable v2 build retained |
| Local server stopped, restarted, and browser reloaded after step 5 | Same run ID, five completed steps, same unfinished v2 and recorded evidence |
| Recover adjustment | v2 = 1,050 units / $10.50; evt_006 = 50 units remains pending |
| Publish next adjustment | v3 = 1,100 units / $11.00; pending zero; prior snapshots preserved |
| Retry evt_004 with a different quantity | Domain conflict 409; six events and all snapshots unchanged |

Selected v1, v2 and v3 in “Show the math” and verified totals and added-event membership. Expanded evt_003 and verified all three timestamps: occurrence on September 20; acceptance before close; processing after close. The final ledger displays 1,100 total units and a caught-up 750-unit ON_TIME projection, with the 350 post-close units explicitly explained rather than mislabeled as lag.

Screenshot: [Completed scenario and preserved balances](scenario-demo.png).

## Evidence boundaries

The application uses real DynamoDB Local transactions and the production domain/store implementation. Event delivery timing and the interruption are controlled by the local scenario. This is **not a real AWS Lambda crash, cloud Streams delivery test, or load test**. The actual process restart above checks local checkpoint and durable build recovery.

No AWS resource was deployed and no authenticated coding-agent-to-AWS connection was claimed. Those submission evidence items remain pending in `evidence/README.md`.
