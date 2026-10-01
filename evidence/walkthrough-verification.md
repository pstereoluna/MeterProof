# Recorded walkthrough verification — October 1, 2026

**Status: implemented and verified locally; AWS deployment pending renewal of the expired login.** The September 30 cloud deployment remains unchanged. This record covers the new presentation and read-only replay endpoint, separately from the [historical cloud smoke](cloud-verification.md).

## Executed checks

- TypeScript typecheck, **17 unit/infrastructure/exporter/route tests**, and CDK synthesis passed.
- **9 DynamoDB Local integration tests** passed, including the actual synthesized Lambda bundle serving the exact replay artifact and leaving its initially empty ledger empty.
- The exporter regenerated `web/replay.json` byte-for-byte from the private historical API smoke files. Its **33 checks** derive from those saved responses; they are not a new cloud test. The public artifact excludes headers, credentials, account identifiers and private paths.
- **29 browser assertions** passed in isolated desktop (1280 × 1000) and mobile (390 × 844) contexts. [Structured results](walkthrough-checks.json) record independent first visits, six-step navigation, back/restart, explicit +$1.00, preserved $7.50, adjusted $8.50, both derivations, conflicting retry evidence, and live/replay switching. No JavaScript errors or horizontal overflow were observed.
- The recorded walkthrough made only GET requests for the page, health and recording. It never requested the live period until **View live record** was clicked. Both views sent **zero POST requests**.
- A fresh isolated **eight-step local UI scenario** completed, preserving v1/v2/v3 and ending at $7.50 original, $0.00 pending and $11.00 latest. This used DynamoDB Local and controlled fault delivery; it was not an AWS fault exercise.
- A read-only cloud observation before the attempted update still showed four events, snapshots 750/850, ON_TIME aggregate 750 and pending zero. No cloud metering writes or resets were issued.

## Deployment status

The pre-deployment comparison could not resolve the account; a direct STS check confirmed the existing `meterproof` login had expired. Browser reauthentication was started. No CloudFormation update was issued. Record the actual deployment and post-deployment checks here after authentication succeeds.

## Evidence boundaries

The artifact replays saved AWS responses from application commit `819c512`, captured October 1, 2026 at 04:03:42–04:03:48 UTC (September 30 Pacific). Accept/close/retry views are reconstructed and labeled. Missing aggregate observations stay null; a missing receipt in a reconstructed step means not observed, not proof of lag. The late/adjust/verify views use full captured period responses.

The UI update adds no AWS service, metering transaction, authentication or reset endpoint. Existing unauthenticated mutation APIs still exist; read-only presentation is not authorization. The cloud run did not force crashes, cutoff races, load or stream expiry. Those claims must remain separate from the local tests.

## Local browser captures

![Recorded adjustment and preserved original in the desktop preview](walkthrough-desktop.png)

[Mobile preview](walkthrough-mobile.png)
