# Robot-game PP — private staging experiment

The owner-only **Prediction** section is at `/prediction`; `/admin/predictions` remains an alias. Its data is served by `/api/admin/predictions`. Production does not include these routes, assets, or navigation.

## Scoring target

The league owner confirmed that each drafted team's OPR is added after **each event**. A participant's season total is the sum of those event contributions across their drafted teams. Awards, wins, advancement bonuses, and pollen prices do not add points. This experiment predicts the OPR contribution per event; it does not implement or write official earned standings.

PP now uses **projected OPR per event**, rounded to two decimals, rather than the previous index normalized to a 100-PP leader. The current evidence is DECODE, so these are DECODE-scale preseason estimates. Raw scoring scales differ between games; this is not a calibrated numerical forecast for BioBuzz. Future results must be evaluated within their own season rather than blended directly with old raw OPR.

## Historical evidence

`prediction-data/decode-event-history.json` records 388 measured team/event rows for 84 historical teams at 20 completed official DECODE events, November 22, 2025 through June 21, 2026. These include San Diego league events and championships/Premier divisions outside the region. The importer retains only historical/current San Diego catalog teams and excludes unfinished events, scrimmages, offseason events, and parent championship records without qualification results. See [source details](prediction-data/README.md).

The metric is FTCScout qualification `opr.totalPointsNp`, excluding points awarded from opponents' penalties. Autonomous and driver-controlled OPR are retained as evidence, but never added again as bonuses to total OPR. Signed measured OPR is preserved. No individual-match OPR is invented.

Only the current draft pool is returned in either API team list. All 70 eligible teams with recorded history have an estimate; the other 17 eligible teams remain unscored. Inactive historical teams can inform testing but cannot appear in a prediction leaderboard or roster. Missing history is not a synthetic zero. A frozen average is an explicitly labeled fallback if a team lacks detailed history; a team lacking both remains unscored.

## Forecast formula

The selected experimental method is `dampedTrend`. For a team's chronologically ordered completed event OPR values \(y_j\), let \(x_j\) be the index of the event completion date (equal dates share an index). The recent mean is

\[
R = \frac{\sum_j 2^{-(x_{\max}-x_j)} y_j}{\sum_j 2^{-(x_{\max}-x_j)}}.
\]

The linear trend per event is

\[
b = \frac{\sum_j (x_j-\bar{x})(y_j-\bar{y})}{\sum_j (x_j-\bar{x})^2},\qquad
\mathrm{PP} = \operatorname{round}_{0.01}(R + 0.5b).
\]

When there is only one distinct completion date, the trend contribution is zero. No extra peak bonus, normalization, or arbitrary zero floor is applied. Decay 0.5 and trend damping 0.5 are fixed illustrative constants; they were not fitted on the later test block. Event counts, match counts, and historical spread explain the supporting evidence. Spread is not a confidence interval and does not automatically add or subtract PP.

Six fixed candidates are compared: historical mean, latest event, prior peak, the old v2 formula in raw OPR units, recent weighted mean, and recent mean plus half the trend. The early chronological block chooses one candidate by mean absolute error (MAE). The selected candidate is used only if sufficient examples exist and its later-block error is below the historical-mean baseline; otherwise the mean is retained. This gate is an experimental safeguard, not proof of general accuracy. All historical processing is cached for the immutable snapshot; saved-roster reads remain request scoped.

## Chronological evaluation

Each replay forecast uses only events that ended strictly before its target event started. Simultaneous or overlapping events cannot supply prior evidence. All candidate methods use the same examples. The first 70% of distinct target start dates form the selection block; later dates form the test block. Selection outcomes that overlap the test boundary are removed. At least ten examples in each block are required to select a candidate.

The imported snapshot yields 304 usable next-event forecasts. There are 288 selection examples and 16 later examples starting April 29, 2026. Selection narrowly chooses `dampedTrend`; the comparison below is from the later block:

| Method | MAE, OPR | RMSE, OPR |
| --- | ---: | ---: |
| Historical mean | 33.713 | 40.719 |
| Old v2 average/peak formula | 30.588 | 37.209 |
| Selected recent mean + half trend | 21.166 | 24.894 |

The selected method has about 37.2% lower MAE than the historical mean on these 16 examples. This is **not an accuracy percentage**. Prior peak performs better on that later block (MAE 16.981), but switching to it after seeing those outcomes would reuse the test set for selection. The small, championship-heavy sample is not representative of every regional team. Team/event errors are correlated, and this experiment establishes neither statistical significance nor cross-season calibration. Final corrected source records are not contemporaneous historical snapshots.

Reproduce all methods and optionally save a new detailed report:

```sh
node scripts/evaluate-prediction-model.mjs
node scripts/evaluate-prediction-model.mjs prediction-data/decode-event-history.json /tmp/decode-replay-report.json
```

The report command refuses to overwrite an existing output. Refreshing the source is a separate explicit step using `scripts/import-prediction-history.mjs`; no background feed silently changes PP.

## Roster and season scenarios

A valid roster has one to three distinct eligible teams within 15 pollen. Its per-event PP is the sum of displayed team PP, consistent with the table. Ties use competition ranks (1, 1, 3). Pollen determines affordability and PP per pollen, never the strength estimate.

The temporary calculator also accepts a planned event count for each selected team:

\[
\mathrm{ScenarioPP} = \sum_{i\in\mathrm{roster}} n_i\,\mathrm{PP}_i.
\]

Counts are explicit assumptions, initially blank, not inferred attendance or known schedules. The calculator supports zero through twelve events per team. It holds that team's current per-event estimate constant across those opportunities; it does not compound the trend or forecast named future events. A missing count or an unscored team with a positive count leaves the scenario incomplete. An explicit zero contributes zero. A scenario is not earned points, a saved entry, or a guarantee of participation.

Saved test rosters remain read-only predictions from the isolated staging D1 database for season 2026–2027. Unknown, ineligible, duplicate, over-budget, malformed, or oversized picks are unranked. Missing measurements are labeled incomplete with a known subtotal. No account IDs or contact details enter the prediction response. Database failure is shown as unavailable rather than falsely empty.

## Validation and deployment

```sh
npm run check
node build-staging.mjs
node --check staging-worker.mjs
node --check staging-predictions-client.js
node --test staging.test.mjs prediction.test.mjs staging-navigation.test.mjs prediction-history.test.mjs scripts/import-prediction-history.test.mjs
```

Checks cover chronological leakage, invalid evidence, selection/holdout separation, signed and missing data, roster behavior, current eligibility, owner authentication, workbook isolation, and absence of prediction routes in production. Browser checks exercise filtering, evidence details, per-event and season-scenario arithmetic, input validation, and mobile layout.

Push to `staging` to run **Deploy private staging**, which deploys only `wrangler.staging.jsonc`. Do not push or merge this experiment to `main` without a separate request to publish.
