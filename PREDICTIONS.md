# DECODE prediction points — staging experiment

Model version: `decode-opr-v1`. Available only on the owner-only staging site at `/admin/predictions` and `/api/admin/predictions`. The green staging banner links to it. The production build does not include these routes, assets, or navigation.

## Formula

For each currently eligible team with a finite average DECODE OPR:

\[
A_i = \max(0,\overline{\mathrm{OPR}}_{i,\mathrm{DECODE}})
\]
\[
H_i^* = \min\left(\max(H_i,A_i),\;1.5A_i\right)
\]
\[
S_i = 0.85A_i + 0.15H_i^*, \qquad
P_i = \operatorname{round}_{0.01}\left(100\frac{S_i}{\max_{j\in E}S_j}\right)
\]

Here `H` is highest DECODE OPR and `E` is the entire eligible pool with DECODE data. Missing peak OPR falls back to average OPR. Missing average OPR means **unscored**, including rookies: no synthetic zero or imputed past performance. If all measured strengths are zero, measured teams receive zero; unscored teams remain unscored. Negative measured average OPR is floored at zero.

Average performance is the main signal. Peak OPR provides a small upside allowance; capping it at 1.5 times average limits that allowance to 7.5% above average strength. This reduces sensitivity to a single exceptional event. It cannot correct for different event counts or uncertainty because those inputs are not present in the frozen export. The 85/15 weights and cap are design choices, not fitted coefficients. No claim of validated prediction accuracy is made.

The normalization is calculated once over the full eligible pool, before search, price filters, or sorting. One prediction point is one hundredth of the reference team's strength, not an actual DECODE match point or earned fantasy point. BioBuzz results, current prices, awards, and historical ranks do not enter the formula. Points per pollen is a separate comparison column, not an input to scoring.

Current frozen data: 87 eligible teams; 70 scored and 17 unscored. Crow Force (#10809) has average OPR 102.63224593582704 and peak OPR 148.91824495149575, yielding strength 109.57514578817734 and 100 prediction points. Rust-eze Robotics (#24730) receives 86.11 points. This is an index of historical DECODE strength, not a calibrated forecast of BioBuzz results.

## Rosters and ranking

For a valid one-to-three-team roster costing at most 15 pollen, predicted roster points are the sum of the teams' displayed two-decimal prediction points. Scores do not change prices or the draft budget. Equal displayed totals share competition ranks (1, 1, 3). Team-number order breaks display-order ties without awarding different ranks.

A roster containing a team with no DECODE data remains unranked and shows an explicitly labeled known subtotal. Duplicate, unknown, no-longer-eligible, over-budget, malformed, or oversized rosters are also unranked, with an explanation. Existing saved picks are read by team ID; this experiment does not rewrite receipts, account snapshots, or prices.

The team leaderboard reads the frozen catalog bundled with the application, not Google Sheets or live event feeds. The roster leaderboard performs one read-only query against the isolated staging D1 database for saved account rosters in season 2026–2027. Unlinked legacy Sheet rows are not included. Missing database access is shown as an unavailable roster view, never silently as an empty league. The temporary roster calculator does not save anything.

## Build and validation

```sh
npm run check
node build-staging.mjs
node --check staging-predictions-client.js
node --test staging.test.mjs prediction.test.mjs
```

The staging build exports the historical catalog only into its generated staging app and packages its HTML/JavaScript separately. Owner verification, staging hostname checks, workbook isolation, noindex, and private/no-store headers cover all prediction routes. Tests verify the formula, peak cap, missing/zero data, ties, roster validity, read-only data access, authentication boundaries, and production route absence.

Push to `staging` to run **Deploy private staging**, which deploys only `wrangler.staging.jsonc`. Do not push or merge this experiment to `main` without a separate request to publish.
