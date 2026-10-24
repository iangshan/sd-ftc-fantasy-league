# Robot-game PP — private staging experiment

The **Prediction** leaderboard is the private staging home page at `/`, replacing the draft board as the roster-entry page. The owner and the two approved admins can access it with verified Google accounts under the staging access rules. `/prediction` and `/admin/predictions` remain aliases. Its forecast data is served by `/api/admin/predictions`; draft settings and submissions use the existing `/api/draft` and `/api/submit` services. Production does not include the replacement page, forecast routes, or navigation. [STAGING.md](STAGING.md) documents access setup, the preserved original board, and the rollback switch.

## Scoring target

The league owner confirmed that each drafted team's OPR is added after **each event**. A participant's season total is the sum of those event contributions across their drafted teams. Awards, wins, advancement bonuses, and Pollen prices do not add points. This experiment predicts the OPR contribution per event; it does not implement or write official earned standings.

PP now uses **projected OPR per event**, rounded to two decimals, rather than the previous index normalized to a 100-PP leader. The current evidence is DECODE, so these are DECODE-scale preseason estimates. Raw scoring scales differ between games; this is not a calibrated numerical forecast for BioBuzz. Future results must be evaluated within their own season rather than blended directly with old raw OPR.

## Historical evidence

`prediction-data/decode-event-history.json` records 388 measured team/event rows for 84 historical teams at 20 completed official DECODE events, November 22, 2025 through June 21, 2026. These include San Diego league events and championships/Premier divisions outside the region. The importer retains only historical/current San Diego catalog teams and excludes unfinished events, scrimmages, offseason events, and parent championship records without qualification results. See [source details](prediction-data/README.md).

The metric is FTCScout qualification `opr.totalPointsNp`, excluding points awarded from opponents' penalties. Autonomous and driver-controlled OPR are retained as evidence, but never added again as bonuses to total OPR. Signed measured OPR is preserved. No individual-match OPR is invented.

Only the current draft pool is returned in either API team list. All 70 eligible teams with recorded history have an estimate; the other 17 eligible teams remain unscored. Inactive historical teams can inform testing but cannot appear in a prediction leaderboard or roster. Missing history is not a synthetic zero. A frozen average is an explicitly labeled fallback if a team lacks detailed history; a team lacking both remains unscored.

## Forecast formula

The selected experimental method is `dampedTrend`. For a team's chronologically ordered completed event OPR values $y_j$, let $x_j$ be the index of the event completion date (equal dates share an index). The recent mean is

$$
R = \frac{\sum_j 2^{-(x_{\max}-x_j)} y_j}{\sum_j 2^{-(x_{\max}-x_j)}}.
$$

The linear trend per event is

$$
b = \frac{\sum_j (x_j-\bar{x})(y_j-\bar{y})}{\sum_j (x_j-\bar{x})^2},\qquad
\mathrm{PP} = \operatorname{round}_{0.01}(R + 0.5b).
$$

When there is only one distinct completion date, the trend contribution is zero. No extra peak bonus, normalization, or arbitrary zero floor is applied. Decay 0.5 and trend damping 0.5 are fixed illustrative constants; they were not fitted on the later test block. Event counts, match counts, and historical spread explain the supporting evidence. Spread is not a confidence interval and does not automatically add or subtract PP.

Six fixed candidates are compared: historical mean, latest event, prior peak, the old v2 formula in raw OPR units, recent weighted mean, and recent mean plus half the trend. The early chronological block chooses one candidate by mean absolute error (MAE). The selected candidate is used only if sufficient examples exist and its later-block error is below the historical-mean baseline; otherwise the mean is retained. This gate is an experimental safeguard, not proof of general accuracy. All historical processing is cached for the immutable snapshot; saved-roster reads remain request scoped.

## Chronological evaluation

Each replay forecast uses only events that ended strictly before its target event started. Simultaneous or overlapping events cannot supply prior evidence. All candidate methods use the same examples. The first 70% of distinct target start dates form the selection block; later dates form the test block. Selection outcomes that overlap the test boundary are removed. At least ten examples in each block are required to select a candidate.

The imported snapshot yields 304 usable next-event forecasts. There are 288 selection examples and 16 later examples starting April 29, 2026. Selection narrowly chooses `dampedTrend`; the comparison below is from the later block:

| Method                            | MAE, OPR | RMSE, OPR |
| --------------------------------- | -------: | --------: |
| Historical mean                   |   33.713 |    40.719 |
| Old v2 average/peak formula       |   30.588 |    37.209 |
| Selected recent mean + half trend |   21.166 |    24.894 |

The selected method has about 37.2% lower MAE than the historical mean on these 16 examples. This is **not an accuracy percentage**. Prior peak performs better on that later block (MAE 16.981), but switching to it after seeing those outcomes would reuse the test set for selection. The small, championship-heavy sample is not representative of every regional team. Team/event errors are correlated, and this experiment establishes neither statistical significance nor cross-season calibration. Final corrected source records are not contemporaneous historical snapshots.

Reproduce all methods and optionally save a new detailed report:

```sh
node scripts/evaluate-prediction-model.mjs
node scripts/evaluate-prediction-model.mjs prediction-data/decode-event-history.json /tmp/decode-replay-report.json
```

The report command refuses to overwrite an existing output. Refreshing the source is a separate explicit step using `scripts/import-prediction-history.mjs`; no background feed silently changes PP.

## Roster and season scenarios

A valid roster has one to three distinct eligible teams within 15 Pollen. Its per-event PP is the sum of displayed team PP, consistent with the table. Ties use competition ranks (1, 1, 3). Pollen determines affordability and PP per Pollen, never the strength estimate.

Prices retain the Draft board's whole-number tiers of 3, 4, 5, 6, and 11 Pollen. The prediction table displays a separate **Pollen cost** column on desktop and mobile; PP per Pollen is labeled as a value ratio inside the evidence details, not shown as a price. Crow Force costs 11 Pollen and Runtime Terror costs 6. Valid roster structures include 11 + 4, 6 + 6 + 3, and 5 + 5 + 5; these are affordable alternatives, not a claim of equal projected performance. The planner shows both spent and remaining Pollen, and the forecast/roster validators reject fractional prices.

The temporary calculator also accepts a planned event count for each selected team:

$$
\mathrm{ScenarioPP} = \sum_{i\in\mathrm{roster}} n_i\,\mathrm{PP}_i.
$$

Counts are explicit assumptions, initially blank, not inferred attendance or known schedules. The calculator supports zero through twelve events per team. It holds that team's current per-event estimate constant across those opportunities; it does not compound the trend or forecast named future events. A missing count or an unscored team with a positive count leaves the scenario incomplete. An explicit zero contributes zero. A scenario is not earned points, a saved entry, or a guarantee of participation.

The leaderboard now supports actual staging roster submissions. All 87 draftable teams appear by default; missing PP never prevents drafting an otherwise eligible team. Current catalog prices, eligibility, open/closed state, preview mode, and `priceVersion` come from `/api/draft`. The page sends selected IDs and the required player details through the existing `leagueAccount.api('/api/submit', ...)`, using Firebase Bearer authentication. It does not submit PP, prices, predicted totals, or planned event counts as authoritative values.

Verified accounts can save one roster per season. Preview mode, closed drafts, existing rosters, pending saves, stale/unavailable account state, invalid picks, and missing details block submission. A confirmed receipt displays the server's actual team IDs and total, including when an idempotent retry returns an earlier saved roster. Failed or ambiguous requests preserve the attempted picks and reconcile account state; My dashboard retains the existing interrupted-save recovery flow. Changing accounts clears contact details, selections, scenarios, and receipt state. No roster is saved merely by selecting a team.

The submitted-roster leaderboard reads the isolated staging D1 database for season 2026–2027. Unknown, ineligible, duplicate, over-budget, malformed, or oversized picks are unranked; a saved roster with missing measurements has incomplete PP and a known subtotal. No account IDs or contact details enter the prediction response. Database failure is shown as unavailable rather than falsely empty. A forecast-data outage still allows drafting from the authoritative catalog with PP marked unavailable; a draft-settings outage pauses submissions.

## Validation and deployment

```sh
npm ci
npm run format:check
npm run check
npm test
```

Checks cover chronological leakage, invalid evidence, selection/holdout separation, signed and missing data, roster behavior, current eligibility, owner/admin Google authentication, role revocation, workbook isolation, homepage/alias/rollback routing, and absence of prediction routes in production. The original submission service is exercised with real local SQLite and a memory-only Sheets boundary, including duplicate prevention and interrupted-write recovery. Browser integration checks cover the actual client-to-submission-service payload and receipt flow, reloads, unscored picks, stale prices, draft closure, preview mode, forecast outages, event-scenario arithmetic, and mobile entry. External Firebase/Sheets authentication is not simulated as a claim of live verification; no existing remote roster is reset or overwritten during these checks.

Push to `staging` to run **Deploy private staging**, which deploys only `wrangler.staging.jsonc`. Do not push or merge this experiment to `main` without a separate request to publish.
