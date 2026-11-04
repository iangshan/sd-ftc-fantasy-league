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

The league is labeled **2027**. The baseline pricing event is the [2026 San Diego Regional (`2026casnd`)](https://www.thebluealliance.com/event/2026casnd), and the optional bonus event is [2026 Stay Classy Classic (`2026casan1`)](https://www.thebluealliance.com/event/2026casan1). Both must supply 2026 REBUILT qualification evidence. The initial target participant/scoring key is `2027casnd`; this is an unconfirmed default until TBA publishes the 2027 event. The importer uses these explicit keys without guessing from event names. Administrators can update the target when the official 2027 listing is available, before any rosters are saved. Event keys, dates, permitted event types, match identities, and team identities are validated against TBA responses.

If the provider has not published the 2027 registrations, staging uses the 2026 San Diego Regional participant list as a clearly marked **provisional preview**. It does not assert that those teams will attend in 2027. Stay Classy Classic attendance never adds teams to the eligible pool. A published 2027 field replaces the preview before any roster is saved. Once rosters exist, a changed participant set requires review; the import preserves the current pool instead of dropping drafted teams.

Administrators select one 2026 baseline event and, optionally, one 2026 off-season bonus event. The baseline also supplies the provisional field. The API's `historyEvents` array preserves that order: baseline first, bonus second when present. Administrators can choose one to five 2027 scoring events; the default is the San Diego Regional. Confirm the intended scoring scope before opening drafting. Changing event choices closes drafting and clears the catalog until a fresh import; settings lock while rosters exist.

## OPR calculation

For each qualification alliance, let `y` equal its published total score minus `foulPoints`, the points awarded for opponents' fouls. Let `A` have one row per alliance, one column per team, and `1` for each of the alliance's three robots. We solve:

```text
OPR = argmin_x ||A x − y||²
```

The implementation solves the normal equations with partial pivoting. It includes every robot at the event, even when that robot is outside the draft pool. It excludes playoffs, awards, wins, and advancement bonuses. At least five qualification appearances per team and a full-rank schedule are required. Missing scores or foul breakdowns stay pending, and malformed or inconsistent scores require review. Events must have ended before their estimates become finalized league results. A validated off-season event is accepted only in the explicitly selected bonus role; the baseline and earned scoring events still require supported official event types.

This is **foul-adjusted qualification OPR**, calculated by this project. It can differ from TBA's published total-score OPR. It estimates contribution from shared alliance scores; it is not a direct measurement of an individual robot. Negative estimates are retained for earned scoring. Annual game changes mean a 2026 OPR is not a calibrated prediction of 2027 points. EPA is not used as earned OPR.

## Pollen prices

For each team, `B` is its finalized foul-adjusted qualification OPR at the baseline San Diego Regional, and `S` is its finalized OPR at Stay Classy Classic. The pricing rating `R` adds half of any improvement:

```text
bonus = 0.5 × max(0, S − B)
R = B + bonus
```

If the off-season result is missing or no better than the baseline, the bonus is zero and `R = B`. A team with baseline OPR 100 and off-season OPR 140 receives a rating of 120. If it skips Stay Classy Classic or records OPR 80 there, its rating remains 100. The 50% weight credits a stronger recent performance while retaining the on-season result as the anchor; it is a pricing policy, not a claim of statistically validated predictive accuracy.

Let `M` be the highest positive **baseline OPR** among eligible teams. The price is:

```text
price = clamp(ceil(11 × max(0, R) / M), 3, 11)
```

The scale `M` excludes off-season bonuses. Giving one team a bonus therefore cannot change the price of a team that missed the off-season event. A bonus can increase or preserve a team's price; rounding and the 11-Pollen cap may leave it unchanged.

A team without a measured baseline receives a provisional price of 3 Pollen and no pricing rating, even when it has an off-season result. A missing baseline is never treated as zero. A pool with no positive baseline also uses provisional 3-Pollen prices. The implementation ignores floating-point noise within `1e-10` of an integer price boundary. Prices are whole numbers and monotonic with pricing rating. Examples of combinations within 15 Pollen are 11 + 4, 7 + 5 + 3, and 5 + 5 + 5; actual available combinations depend on the event's teams.

The catalog and its quoted historical evidence freeze once the first roster is saved. Each receipt preserves team names, prices, and the catalog version. Refreshing results does not retroactively change paid prices. Without any saved rosters, refreshed history may update prices.

## Weight classes

Weight classes exist only to rank rosters. They do not restrict drafting, change prices, or alter any saved roster.

Prices sort the pool into **weight classes**: contiguous Pollen bands over the prices the pool actually contains. The bands are chosen to satisfy two requirements, in order:

1. **Affordability.** The sum of the bands' cheapest prices must not exceed the budget, so a roster holding one team from every class always fits inside 15 Pollen. When no split at that many bands is affordable, the pool uses one fewer class instead of pricing a full roster out of reach.
2. **Balance.** Among affordable splits, the implementation minimizes the squared deviation of each band's team count from an equal share. Equally balanced splits take the one whose smallest class is largest, then the one with the cheapest boundaries. A class therefore holds a comparable share of the field and is not led by default.

With up to three teams per roster, a typical San Diego field yields three classes — **Light**, **Middle**, and **Heavy**. Because OPR distributions are right-skewed, the cheapest band is usually the single 3-Pollen price while the dearest spans most of the upper range. Pools with two affordable bands are named Light and Heavy; a single band is named Open. Classes are derived from the quoted prices, so a catalog frozen by the first saved roster keeps its classes unchanged, and nothing extra is stored alongside the prices.

## Earned standings and test rosters

```text
earned OPR    = sum of a team's finalized OPR at each counted 2027 event
class points  = 100 × max(0, earned OPR) / the best earned OPR in the competing class
roster points = sum of the class points of a roster's picks
```

Every weight class awards the same 100 points. Its strongest earner takes the full award and its classmates are scored against it, so the leading 3-Pollen team earns exactly as much as the leading 11-Pollen team. A higher price buys a better chance of leading a class, never a larger award. Class awards are relative to the whole eligible pool, never to the teams that happened to be drafted. Only robot-game OPR counts; awards, wins, and advancement add no points.

A class awards its points once per roster. If a roster drafts two teams from the same class, one competes in that class and the other competes in the **dearest class**, where it is measured against the strongest team in the field. The implementation keeps whichever arrangement totals highest for that roster, so neither the order of the picks nor the order of the catalog changes a rank. Teams already in the dearest class are never moved. A promoted team is not a member of the class it competes in and can out-earn that class's leader, so its award is capped at the class's points; no team scores more than one award. Stacking a class remains a legal, unrestricted choice; it simply costs a roster the easier comparison.

The published maximum is one class award per pick: 300 for a full three-team roster. Reaching it requires every pick to lead the class it competes in, which realistically means contesting separate classes — a promoted team has to match the strongest team in the field, and a single expensive team can only ever earn one award. A pool thin enough to hold just one weight class still lets every pick contest it, so the maximum is never capped below what a roster can score.

A team absent from every counted event earns no class points. A negative contribution estimate scores zero instead of deducting from its classmates, and a class in which no team finished above zero awards nothing to anyone. Earned OPR itself still retains negative estimates.

An event contributes once. Re-imports replace its results by event key, so corrected scores update standings without duplicating points; a correction can change which team leads a class and therefore every classmate's share. Both historical 2026 events, including Stay Classy Classic, contribute zero earned 2027 points. The off-season improvement bonus is used only for prices. This page shows earned standings, not the retired prediction leaderboard.

The server validates membership, the current league, season, catalog version, team eligibility, roster size, and budget. Each verified user has one roster for this league and season. Repeated submissions return the original receipt. Test drafting closes at the start of a counted event (conservatively at midnight UTC on its published start date). An open staging draft permits a user to reset only their own test roster; this is unavailable after a counted event begins.

## Implementation and verification

- `src/frc/opr.mjs`: qualification least squares, Pollen pricing, weight-class bands, and roster ranking.
- `src/frc/tba.mjs`: fixed-origin provider client and evidence validation.
- `src/frc/service.mjs`: transactional imports, settings, saved rosters, and earned standings.
- `web/frc.*`: shared-design draft board, roster, and administrator screens.
- `migrations/0006_frc_drafting.sql`: isolated FRC tables, applied only by staging deployment.
- `migrations/0007_frc_pricing_events.sql`: confirmed historical event keys and an unconfirmed 2027 default, applied only to the initial configuration without saved rosters.

The `STAGING_FRC_ENABLED` flag enables this implementation only for San Diego FRC. A refresh lease prevents overlapping imports and roster saves during publication. Event updates, catalog publication, and the sync audit commit in one D1 batch. Provider failures retain the last successful snapshot. The existing Google verification, invitation, same-origin, and league-role boundaries also protect every FRC route.

Tests use synthetic, explicitly labeled local match fixtures. They check known OPR recovery, foul removal, incomplete evidence, bonus-only pricing, missing baseline and off-season results, unchanged absentee prices, repeated and corrected scoring, whole-number pricing, balanced and affordable weight classes, class points relative to a class leader, equal awards for the cheapest and dearest classes, zero awards for negative or absent results, a stacked class promoting its extra team to the dearest class independently of pick order, a published maximum that no roster shape can exceed, ranking that writes to no table, a saved roster surviving a team missing from the catalog, server-enforced budgets, migration replay, transaction rollback, role boundaries, and isolation from FTC. Browser checks drive the real draft-board script against the page's own element ids with a real API payload, so a view cannot reference an element the template lacks. They use simulated verified identities and do not substitute for a real Google sign-in by a participant.

Data attribution: [The Blue Alliance](https://www.thebluealliance.com/) and [its API documentation](https://www.thebluealliance.com/apidocs/v3). This project's MIT license covers its code, not third-party competition data or FIRST trademarks.
