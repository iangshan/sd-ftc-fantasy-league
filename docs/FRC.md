# San Diego FRC · 2027 season

The FRC draft is available on **private staging** for review. Its participant pool is all San Diego Regional teams, including visitors from other regions. Proposed rules are 15 Pollen and one to three different teams. This release does not enable public FRC drafting or change FTC rosters, prices, or scoring.

## Connect competition data

1. Create a free **Read API key** at [The Blue Alliance account page](https://www.thebluealliance.com/account).
2. In Cloudflare, select **sd-ftc-fantasy-staging → Settings → Variables and Secrets**.
3. Add a **Secret** with the name `TBA_AUTH_KEY`. Its value is the actual TBA key. Save/deploy the settings change. The environment labeled Production within this Worker is its active staging deployment.
4. Sign into staging, select San Diego FRC in **Leagues & access**, then open **FRC admin**.
5. Import the data, review the pool and event choices, and open test drafting when ready.

Never commit the key, put it in a browser script, or include it in an invitation. The scheduled import runs every five minutes. A failed import preserves the last successful data and displays a status message in FRC admin. Deployment verification checks that the secret name exists and waits for a successful scheduled import; it never reads the secret value or player rosters.

## Seasons and participant lists

The league is labeled **2027**. The target participant event and default scoring event are `2027casd`. The default historical pricing event is `2026casd`, the 2026 San Diego Regional during REBUILT. Event keys, dates, official event type, match identities, and team identities are validated against TBA responses.

If the provider has not published the 2027 registrations, staging uses the 2026 participant list as a clearly marked **provisional preview**. It does not assert that those teams will attend in 2027. A published 2027 field replaces the preview before any roster is saved. Once rosters exist, a changed participant set requires review; the import preserves the current pool instead of dropping drafted teams.

Administrators can select one to five 2026 pricing events and one to five 2027 scoring events. The first pricing event also supplies the provisional field. Defaults use the San Diego Regional, not every event in either season. Confirm the intended scoring scope before opening drafting. Changing event choices closes drafting and clears the catalog until a fresh import; settings lock while rosters exist.

## OPR calculation

For each qualification alliance, let `y` equal its published total score minus `foulPoints`, the points awarded for opponents' fouls. Let `A` have one row per alliance, one column per team, and `1` for each of the alliance's three robots. We solve:

```text
OPR = argmin_x ||A x − y||²
```

The implementation solves the normal equations with partial pivoting. It includes every robot at the event, even when that robot is outside the draft pool. It excludes playoffs, awards, wins, and advancement bonuses. At least five qualification appearances per team and a full-rank schedule are required. Missing scores or foul breakdowns stay pending, and malformed or inconsistent scores require review. Events must have ended before their estimates become finalized league results.

This is **foul-adjusted qualification OPR**, calculated by this project. It can differ from TBA's published total-score OPR. It estimates contribution from shared alliance scores; it is not a direct measurement of an individual robot. Negative estimates are retained for earned scoring. Annual game changes mean a 2026 OPR is not a calibrated prediction of 2027 points. EPA is not used as earned OPR.

## Pollen prices

For each team, `H` is the mean of its finalized OPRs across the selected 2026 events in which it has measured results. `M` is the largest positive `H` in the eligible participant pool.

```text
price = clamp(ceil(11 × max(0, H) / M), 3, 11)
```

An unmeasured team, or a pool with no positive history, costs a provisional 3 Pollen. The implementation ignores floating-point noise within `1e-10` of an integer price boundary. Prices are whole numbers and monotonic with historical OPR. Examples of combinations within 15 Pollen are 11 + 4, 7 + 5 + 3, and 5 + 5 + 5; actual available combinations depend on the event's teams.

The catalog and its quoted historical evidence freeze once the first roster is saved. Each receipt preserves team names, prices, and the catalog version. Refreshing results does not retroactively change paid prices. Without any saved rosters, refreshed history may update prices.

## Earned standings and test rosters

```text
roster points = sum of each drafted team's finalized OPR at each counted 2027 event
```

An event contributes once. Re-imports replace its results by event key, so corrected scores update standings without duplicating points. A team absent from a counted event earns no points from that event. Historical 2026 events contribute zero earned 2027 points. This page shows earned standings, not the retired prediction leaderboard.

The server validates membership, the current league, season, catalog version, team eligibility, roster size, and budget. Each verified user has one roster for this league and season. Repeated submissions return the original receipt. Test drafting closes at the start of a counted event (conservatively at midnight UTC on its published start date). An open staging draft permits a user to reset only their own test roster; this is unavailable after a counted event begins.

## Implementation and verification

- `src/frc/opr.mjs`: qualification least squares and Pollen pricing.
- `src/frc/tba.mjs`: fixed-origin provider client and evidence validation.
- `src/frc/service.mjs`: transactional imports, settings, saved rosters, and earned standings.
- `web/frc.*`: shared-design draft board, roster, and administrator screens.
- `migrations/0006_frc_drafting.sql`: isolated FRC tables, applied only by staging deployment.

The `STAGING_FRC_ENABLED` flag enables this implementation only for San Diego FRC. A refresh lease prevents overlapping imports and roster saves during publication. Event updates, catalog publication, and the sync audit commit in one D1 batch. Provider failures retain the last successful snapshot. The existing Google verification, invitation, same-origin, and league-role boundaries also protect every FRC route.

Tests use synthetic, explicitly labeled local match fixtures. They check known OPR recovery, foul removal, incomplete evidence, repeated and corrected scoring, whole-number pricing, server-enforced budgets, migration replay, transaction rollback, role boundaries, and isolation from FTC. Browser checks use simulated verified identities; they do not substitute for a real Google sign-in by a participant.

Data attribution: [The Blue Alliance](https://www.thebluealliance.com/) and [its API documentation](https://www.thebluealliance.com/apidocs/v3). This project's MIT license covers its code, not third-party competition data or FIRST trademarks.
