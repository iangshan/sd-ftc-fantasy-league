# Event history source

`scripts/import-prediction-history.mjs` imports public DECODE 2025–26 event statistics from [FTCScout's GraphQL API](https://api.ftcscout.org/graphql). No event history is fabricated if this endpoint cannot be reached. The existing average/peak catalog alone cannot establish event counts, dates, or uncertainty.

Run from the repository root after building the staging app:

```sh
npm run build:staging
node --test tests/import-prediction-history.test.mjs
node scripts/import-prediction-history.mjs
```

The default output is `data/predictions/decode-event-history.json`. The importer discovers all official events attended by team numbers from the combined frozen and current-draft catalogs, including championships outside San Diego. It then fetches each unique event and retains only the selected catalog teams. Inactive historical teams can supply evaluation data; this does not make them eligible for display or drafting. It excludes scrimmages, offseason events, and unfinished/unpublished events. A past date is insufficient: the source must also report that the event is finished and not ongoing, and every scheduled qualification match must have a played flag and score record. Missing qualification results cause the whole event to be excluded and recorded in `excludedEvents`.

Schema version 1 contains `season`, `source`, `selectedTeamNumbers`, `excludedEvents`, and `events`. Each event supplies `code`, `name`, `startDate`, `endDate`, `type`, `region`, `status: "complete"`, `qualificationMatches`, and `teams`. Each measured team row supplies `teamNumber`, `opr`, `autoOpr`, `driverControlledOpr`, and `qualMatchesPlayed`. Negative measured OPR is retained as source data; missing OPR is not replaced with zero. Rows with no recorded qualifying match are excluded.

The robot-game metric is FTCScout `opr.totalPointsNp`: event qualification OPR excluding points awarded from opponents' penalties. Its autonomous and driver-controlled components are recorded as evidence, not additional bonuses to the total. FTCScout's public implementation filters statistics to qualification matches; this importer does not recalculate OPR or claim individual-match OPR is available. API schema was checked against the [FTCScout source](https://github.com/ftc-scout/ftc-scout), commit `05c44a28fe0f0a80101e63134db9a518d9d7ed6c`.

Each import records retrieval time, exact discovery and event-detail GraphQL queries, source URL/metric, completion criteria, and a SHA-256 of the assembled event-detail API records. JSON is written atomically only after all included records validate and at least one complete measured event exists. A failed request or invalid response leaves the existing output untouched. Review the resulting coverage and excluded-event list before deploying an updated snapshot.

This is final historical data fetched today, not a collection of real-time historical snapshots. Chronological evaluation can keep later events out of inputs, but cannot establish what corrected source results looked like on the original publication date. Current-season or cross-season forecast accuracy requires separate validation.
