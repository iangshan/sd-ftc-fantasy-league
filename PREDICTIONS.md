# DECODE prediction points — staging experiment

Model version: `decode-opr-v2`. Available only on the owner-only staging site in the **Prediction** navigation section at `/prediction`. The earlier `/admin/predictions` address remains an alias, and data is served by `/api/admin/predictions`. The production build does not include these routes, assets, or navigation.

## Historical DECODE leaderboard

The default leaderboard includes the **84 San Diego teams with recorded average DECODE OPR** in the frozen catalog. It includes teams that are no longer in the current draft, such as Definitely Human (#19743) and SEGFAULT (#31862). Current-season rookie additions are not inserted into this historical leaderboard.

The archive contains 87 rows. Three have no recorded average OPR and cannot be ranked from this data; this does not establish that they never competed. The archive is a San Diego export, not a complete worldwide DECODE competitor list. The page reports this coverage explicitly rather than presenting the missing rows as zero-point teams.

Current draft eligibility remains separate: 87 eligible teams, of which 70 have recorded DECODE OPR and 17 are unscored. Historical teams outside the current draft can be inspected but cannot be added to a fantasy roster. The current-draft view uses the same historical scores and ranks; it does not redefine the reference team.

## Formula

For each team in the historical DECODE catalog with a finite average DECODE OPR:

\[
A_i = \max(0,\overline{\mathrm{OPR}}_{i,\mathrm{DECODE}})
\]
\[
H_i^* = \min\left(\max(H_i,A_i),\;1.5A_i\right)
\]
\[
S_i = 0.85A_i + 0.15H_i^*, \qquad
P_i = \operatorname{round}_{0.01}\left(100\frac{S_i}{\max_{j\in D}S_j}\right)
\]

Here `H` is highest DECODE OPR and `D` is the full set of recorded teams in the frozen San Diego DECODE catalog, regardless of current draft eligibility. Missing peak OPR falls back to average OPR. Missing average OPR means **unscored**, including rookies: no synthetic zero or imputed past performance. If all measured strengths are zero, measured teams receive zero; unscored teams remain unscored. Negative measured average OPR is floored at zero.

Average performance is the main signal. Peak OPR provides a small upside allowance; capping it at 1.5 times average limits that allowance to 7.5% above average strength. This reduces sensitivity to a single exceptional event. It cannot correct for different event counts or uncertainty because those inputs are not present in the frozen export. The 85/15 weights and cap are design choices, not fitted coefficients. No claim of validated prediction accuracy is made.

The normalization is calculated once over the full recorded historical pool, before search, current eligibility, price filters, or sorting. Even if the strongest historical team leaves the current draft, other teams retain their historical points. One prediction point is one hundredth of the reference team's strength, not an actual DECODE match point or earned fantasy point. BioBuzz results, current prices, awards, and historical ranks do not enter the formula. Points per pollen is a separate comparison column, not an input to scoring.

Crow Force (#10809) has average OPR 102.63224593582704 and peak OPR 148.91824495149575, yielding strength 109.57514578817734 and 100 prediction points. Definitely Human (#19743) receives 88.63 points, Rust-eze Robotics (#24730) receives 86.11, and SEGFAULT (#31862) receives 84.62. This is an index of historical DECODE strength, not a calibrated forecast of BioBuzz results. Version 2 changes the reference cohort from the current draft to recorded historical DECODE teams; the 85/15 weights and cap are unchanged.

## Rosters and ranking

For a valid one-to-three-team roster costing at most 15 pollen, predicted roster points are the sum of the teams' displayed two-decimal prediction points. Scores do not change prices or the draft budget. Equal displayed totals share competition ranks (1, 1, 3). Team-number order breaks display-order ties without awarding different ranks.

A roster containing a team with no DECODE data remains unranked and shows an explicitly labeled known subtotal. Duplicate, unknown, no-longer-eligible, over-budget, malformed, or oversized rosters are also unranked, with an explanation. Existing saved picks are read by team ID; this experiment does not rewrite receipts, account snapshots, or prices.

The team leaderboard reads the frozen historical catalog bundled with the application, not Google Sheets or live event feeds. The API returns this historical list as `teams` and the separate current eligible list as `draftTeams`; both use one historical baseline, with source counts in `coverage`. The roster leaderboard performs one read-only query against the isolated staging D1 database for saved account rosters in season 2026–2027 and validates their picks against `draftTeams`. Unlinked legacy Sheet rows are not included. Missing database access is shown as an unavailable roster view, never silently as an empty league. The temporary roster calculator does not save anything.

## Build and validation

```sh
npm run check
node build-staging.mjs
node --check staging-predictions-client.js
node --test staging.test.mjs prediction.test.mjs staging-navigation.test.mjs
```

The staging build exports the historical and current draft catalogs only into its generated staging app and packages its HTML/JavaScript separately. Owner verification, staging hostname checks, workbook isolation, noindex, and private/no-store headers cover all prediction routes. Tests verify historical cohort coverage, exclusion of current-season newcomers from that cohort, a shared reference even when its leader leaves the draft, stable filtered ranks, the formula, peak cap, missing/zero data, ties, roster validity, read-only data access, authentication boundaries, and production route absence.

Push to `staging` to run **Deploy private staging**, which deploys only `wrangler.staging.jsonc`. Do not push or merge this experiment to `main` without a separate request to publish.
