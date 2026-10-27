# Historical PP model and current Pollen pricing

The prediction leaderboard, its forecast API, and scenario calculator have been removed. FTC players now use the **Draft board** at `/`. Old prediction-page bookmarks redirect home; the prediction API and browser asset are unavailable. League memberships, saved rosters, the 15-Pollen budget, and current prices are preserved.

This document retains the public model and evidence used to derive those Pollen prices. The pricing-only integration lives in [staging/pricing.mjs](../staging/pricing.mjs). It does not expose team forecasts or rank saved rosters. [Staging guide](../staging/README.md) describes the current site.

## Scoring target

The league owner confirmed that each drafted team's OPR is added after **each event**. A participant's season total is the sum of those event contributions across their drafted teams. Awards, wins, advancement bonuses, and Pollen prices do not add points. This experiment predicts the OPR contribution per event; it does not implement or write official earned standings.

PP now uses **projected OPR per event**, rounded to two decimals, rather than the previous index normalized to a 100-PP leader. The current evidence is DECODE, so these are DECODE-scale preseason estimates. Raw scoring scales differ between games; this is not a calibrated numerical forecast for BioBuzz. Future results must be evaluated within their own season rather than blended directly with old raw OPR.

## Historical evidence

`data/predictions/decode-event-history.json` records 388 measured team/event rows for 84 historical teams at 20 completed official DECODE events, November 22, 2025 through June 21, 2026. These include San Diego league events and championships/Premier divisions outside the region. The importer retains only historical/current San Diego catalog teams and excludes unfinished events, scrimmages, offseason events, and parent championship records without qualification results. See [source details](../data/predictions/README.md).

The metric is FTCScout qualification `opr.totalPointsNp`, excluding points awarded from opponents' penalties. Autonomous and driver-controlled OPR are retained as evidence, but never added again as bonuses to total OPR. Signed measured OPR is preserved. No individual-match OPR is invented.

Only the current eligible draft pool is priced. All 70 eligible teams with recorded history have an estimate; the other 17 eligible teams remain unscored. Inactive historical teams can inform testing but cannot appear in a prediction leaderboard or roster. Missing history is not a synthetic zero. A frozen average is an explicitly labeled fallback if a team lacks detailed history; a team lacking both remains unscored.

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

Six fixed candidates are compared: historical mean, latest event, prior peak, the old v2 formula in raw OPR units, recent weighted mean, and recent mean plus half the trend. The early chronological block chooses one candidate by mean absolute error (MAE). The selected candidate is used only if sufficient examples exist and its later-block error is below the historical-mean baseline; otherwise the mean is retained. This gate is an experimental safeguard, not proof of general accuracy. Historical processing is cached for the immutable pricing snapshot. Pricing does not read saved rosters.

## Chronological evaluation

Each replay forecast uses only events that ended strictly before its target event started. Simultaneous or overlapping events cannot supply prior evidence. All candidate methods use the same examples. The first 70% of distinct target start dates form the selection block; later dates form the test block. Selection outcomes that overlap the test boundary are removed. At least ten examples in each block are required to select a candidate.

The imported snapshot yields 304 usable next-event forecasts. There are 288 selection examples and 16 later examples starting April 29, 2026. Selection narrowly chooses `dampedTrend`; the comparison below is from the later block:

| Method                            | MAE, OPR | RMSE, OPR |
| --------------------------------- | -------: | --------: |
| Historical mean                   |   33.713 |    40.719 |
| Old v2 average/peak formula       |   30.588 |    37.209 |
| Selected recent mean + half trend |   21.166 |    24.894 |

The selected method has about 37.2% lower MAE than the historical mean on these 16 examples. This is **not an accuracy percentage**. Prior peak performs better on that later block (MAE 16.981), but switching to it after seeing those outcomes would reuse the test set for selection. The small, championship-heavy sample is not representative of every regional team. Team/event errors are correlated, and this experiment establishes neither statistical significance nor cross-season calibration. Final corrected source records are not contemporaneous historical snapshots.

From the repository root, reproduce all methods and optionally save a new detailed report:

```sh
node scripts/evaluate-prediction-model.mjs
node scripts/evaluate-prediction-model.mjs data/predictions/decode-event-history.json /tmp/decode-replay-report.json
```

The report command refuses to overwrite an existing output. Refreshing the source is a separate explicit step using `scripts/import-prediction-history.mjs`; no background feed silently changes PP.

## Pollen pricing in staging

Staging derives Pollen cost from each team's current per-event PP. The public website retains its legacy prices; this policy neither changes the PP forecast formula nor rewrites the frozen Sheet catalog. The implementation is public in [src/predictions/pricing.mjs](../src/predictions/pricing.mjs).

Let $M$ be the highest available PP among all eligible teams. Define a shared PP unit $U$ and each scored team's price $C_i$:

$$
U = \max\left(1,\left\lceil\frac{M}{11}\right\rceil\right),\qquad
C_i = \min\left(11,\max\left(3,\left\lceil\frac{\mathrm{PP}_i}{U}\right\rceil\right)\right).
$$

A team with no PP receives a provisional cost of 3 Pollen; its PP stays missing, not zero. All prices are whole numbers between 3 and 11. The unit is computed and cached from the complete eligible pool, so searching, filtering, and roster selections cannot change prices. Prices never feed back into the PP model.

For the current snapshot, $U=15$. Rust-eze Robotics (#24730), with 59.86 PP, costs 4 Pollen instead of its legacy 11. Crow Force (#10809) costs 11, Fusion (#18142) costs 9, and Runtime Terror (#22105) costs 8.

The 15-Pollen budget supports several roster structures in the current snapshot:

| Teams                                      | Pollen         | Per-event PP |
| ------------------------------------------ | -------------- | -----------: |
| Crow Force + Rust-eze Robotics             | 11 + 4 = 15    |       220.96 |
| Bengal Bots + Pointers + Matador Mechanics | 7 + 5 + 3 = 15 |       219.58 |
| Pointers + UC Robotics + RoBusted          | 5 + 5 + 5 = 15 |       213.78 |

These illustrate affordable options with different team combinations; they do not guarantee equal performance or establish forecast accuracy. This documentation table records the model outputs behind the prices; the draft board does not display PP forecasts.

The server applies this policy only in staging, after checking the raw frozen catalog against the Sheet. It derives the effective `priceVersion` from the current priced catalog. Both `/api/draft` and submission validation use that authoritative price quote; an older quote must refresh before a new submission. The browser cannot supply its own prices or change the pricing unit.

Existing receipts, interrupted-save checkpoints, and archived rosters keep their originally paid prices. They are not repriced or reset.

## Drafting and validation

FTC players can save one roster per season through the draft board and review their original paid picks in My dashboard. The draft API and submission service remain authoritative for current prices, eligibility, budget limits, and duplicate prevention. FRC drafting is disabled pending separate rules.

```sh
npm ci
npm run format:check
npm run check
npm test
```

Checks retain model/pricing validation and cover league access, retired-route behavior, current draft eligibility and costs, duplicate prevention, and interrupted-write recovery. Browser checks exercise draft selection, whole-number price filters, submission receipts, account changes, mobile layouts, and the separate league-management flow. External Firebase and Sheets use local fixtures during browser tests; no existing remote roster is reset or overwritten.

Push to `staging` to run **Deploy private staging**, which deploys only `staging/wrangler.jsonc`. Reviewed source can be merged into `main` without changing the public site. Public Worker deployment requires a separately authorized **Check and deploy** manual run on `main` with `deploy_production` enabled; it defaults to false. See [the release procedure](DEVELOPERS.md#branches-and-deployment).
