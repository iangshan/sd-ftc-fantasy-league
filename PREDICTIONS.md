# DECODE PP — staging experiment

Model version: `decode-opr-v2`. Available only on the owner-only staging site in the **Prediction** navigation section at `/prediction`. The earlier `/admin/predictions` address remains an alias, and data is served by `/api/admin/predictions`. The production build does not include these routes, assets, or navigation.

## Eligible DECODE leaderboard

The default leaderboard includes the **70 currently draftable San Diego teams with recorded average DECODE OPR** in the frozen catalog. The 14 recorded teams outside the current draft, including Definitely Human (#19743) and SEGFAULT (#31862), are excluded from every leaderboard view and the API's team lists.

The archive contains 87 rows. Three have no recorded average OPR and cannot be ranked from this data; this does not establish that they never competed. The archive is a San Diego export, not a complete worldwide DECODE competitor list. The page reports this coverage explicitly rather than presenting the missing rows as zero-point teams.

The full current-draft view includes all 87 eligible teams: the same 70 scored teams and 17 unscored teams. Current-season newcomers receive no invented DECODE performance. Both views rank the scored teams within this eligible pool, with no rank gaps caused by excluded teams. The historical reference used to calculate PP remains unchanged.

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
\mathrm{PP}_i = \operatorname{round}_{0.01}\left(100\frac{S_i}{\max_{j\in D}S_j}\right)
\]

Here `H` is highest DECODE OPR and `D` is the full set of recorded teams in the frozen San Diego DECODE catalog, regardless of current draft eligibility. Missing peak OPR falls back to average OPR. Missing average OPR means **unscored**, including rookies: no synthetic zero or imputed past performance. If all measured strengths are zero, measured teams receive zero; unscored teams remain unscored. Negative measured average OPR is floored at zero.

Average performance is the main signal. Peak OPR provides a small upside allowance; capping it at 1.5 times average limits that allowance to 7.5% above average strength. This reduces sensitivity to a single exceptional event. It cannot correct for different event counts or uncertainty because those inputs are not present in the frozen export. The 85/15 weights and cap are design choices, not fitted coefficients. No claim of validated prediction accuracy is made.

The normalization is calculated once over all 84 recorded historical teams, before current eligibility, search, price filters, or sorting. Even if the strongest historical team leaves the current draft, other teams retain their PP. One PP is one hundredth of the reference team's strength, not an actual DECODE match point or earned fantasy point. BioBuzz results, current prices, awards, and historical ranks do not enter the formula. PP per pollen is a separate comparison column, not an input to scoring.

Crow Force (#10809) has average OPR 102.63224593582704 and peak OPR 148.91824495149575, yielding strength 109.57514578817734 and 100 PP. Rust-eze Robotics (#24730) retains 86.11 PP and ranks second among eligible teams. This is an index of historical DECODE strength, not a calibrated forecast of BioBuzz results. Version 2 uses recorded historical DECODE teams as its reference cohort; eligibility filtering does not change the formula, PP, or model version.

## Rosters and ranking

For a valid one-to-three-team roster costing at most 15 pollen, roster PP is the sum of the teams' displayed two-decimal PP. Scores do not change prices or the draft budget. Equal displayed totals share competition ranks (1, 1, 3), for both team and roster leaderboards. Team-number order breaks display-order ties without awarding different ranks. Search and price filters preserve these eligible-pool ranks.

A roster containing a team with no DECODE data remains unranked and shows an explicitly labeled known subtotal. Duplicate, unknown, no-longer-eligible, over-budget, malformed, or oversized rosters are also unranked, with an explanation. Existing saved picks are read by team ID; this experiment does not rewrite receipts, account snapshots, or prices.

The team leaderboard reads the frozen historical and current-draft catalogs bundled with the application, not Google Sheets or live event feeds. The API returns 70 eligible scored rows as `teams` and all 87 eligible rows as `draftTeams`. The historical 84-team reference is calculated internally; excluded historical rows are not returned. Both lists use that shared baseline and matching eligible-pool ranks. `coverage` retains the archive counts (87 total, 84 recorded, 3 missing OPR), reports 70 eligible and 14 excluded recorded teams, and reports the current-draft counts (87 total, 70 scored, 17 unscored). The roster leaderboard performs one read-only query against the isolated staging D1 database for saved account rosters in season 2026–2027 and validates their picks against `draftTeams`. Unlinked legacy Sheet rows are not included. Missing database access is shown as an unavailable roster view, never silently as an empty league. The temporary roster calculator does not save anything.

## Build and validation

```sh
npm run check
node build-staging.mjs
node --check staging-predictions-client.js
node --test staging.test.mjs prediction.test.mjs staging-navigation.test.mjs
```

The staging build exports the historical and current draft catalogs only into its generated staging app and packages its HTML/JavaScript separately. Owner verification, staging hostname checks, workbook isolation, noindex, and private/no-store headers cover all prediction routes. Tests verify eligible cohort coverage, exclusion of all 14 ineligible recorded teams, unchanged PP and a shared historical reference even when its leader leaves the draft, ranks within the eligible pool, the formula, peak cap, missing/zero data, ties, roster validity, read-only data access, authentication boundaries, and production route absence.

Push to `staging` to run **Deploy private staging**, which deploys only `wrangler.staging.jsonc`. Do not push or merge this experiment to `main` without a separate request to publish.
