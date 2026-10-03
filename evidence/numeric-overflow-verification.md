# Exact totals and overflow recovery — local verification

Verified on October 2, 2026 against the local change based on `ad3e631`. This is local implementation and test evidence, not a new AWS deployment or cloud verification.

## Problem and correction

Two individually valid event quantities could exceed JavaScript's safe integer range when summed. The old close/adjust code reserved its durable fence, then returned 422 on the sum; repeating the operation could not finish the same ledger range. Clearing that build would discard recovery context without fixing the underlying sum.

Snapshot and pending totals now use exact integer arithmetic. Safe totals remain JSON numbers; larger totals use canonical decimal strings. DynamoDB aggregate numeric ADD remains unchanged, with the SDK's large `bigint` values normalized before JSON serialization. The UI uses exact arithmetic and cent formatting and accommodates long values. Event input validation, ingestion transactions, snapshot membership and historical snapshots retain their existing semantics.

The separate review finding about unknown fields was a false positive: `foo: "bar"` is rejected with 400. Regression coverage confirms invalid inputs do not write ledger records.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run check` | Typecheck, 24 unit/display/infrastructure/replay tests and CDK synthesis passed |
| `npm run test:integration` | All 12 DynamoDB Local/scenario/bundled-Lambda tests passed |
| `git diff --check` | Passed |
| Browser: large values | Exact `$90,071,992,547,409.93` and unit totals rendered at 1280×900 and 390×844; checked page and numeric-cell widths for clipping |
| Browser: original recording | All six saved scenes checked at both viewport sizes; original $7.50 and adjusted $8.50 retained; no page JavaScript errors |

The regression suite exercises:

- `9007199254740991 + 2` becoming exactly `"9007199254740993"`, including pending totals, direct close, adjustment and JSON responses.
- Real DynamoDB numeric ADD decoding to `bigint`, receipt redelivery not incrementing twice, and large snapshot totals surviving storage round trips.
- Recovery from a persisted build with the same shape and overflowing ledger range left by the previous implementation. Both close and adjustment reuse the saved fence/start time; later-epoch events stay pending, earlier snapshots stay unchanged, and same-operation retries return the published result. These tests seed the durable pre-recovery state; they do not claim a deployed code-upgrade experiment or an actual Lambda crash.
- The synthesized Lambda API bundle accepting large post-close quantities, returning exact pending totals, publishing the next version and preserving prior versions.
- Shipped page functions formatting integer cents and comparing projection differences exactly, including a one-unit difference above the safe integer range.

Backend integration used isolated, uniquely named tables on DynamoDB Local at loopback; tests removed those tables. Browser large-value checks used intercepted local API responses, while the normal walkthrough used the existing saved recording. No live cloud ledger writes, AWS API calls or deployment were part of this verification. Initial sandbox restrictions on the loopback connection and CDK output were resolved before the successful checks above.

## Limits

This corrects arithmetic and serialization, not DynamoDB item-size limits, aggregate numeric storage limits, execution timeouts, source completeness or access control. The numeric API representation is documented in [the API contract](../docs/api-contract.md); callers must not coerce large decimal strings to JavaScript `Number`. The normal demo fixture remains numeric. Historical AWS evidence describes the earlier deployed revisions and does not establish cloud execution of this change.
