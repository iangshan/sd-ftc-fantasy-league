# CLAUDE.md

Read this first. It is the shared briefing for everyone working on **FIRST Fantasy League** — human contributors and AI assistants alike. [AGENTS.md](AGENTS.md) holds the owner's current standing directives for the active rollout; this file explains the project, the rules you must not break, and how to work in it.

**Keep this file current.** When you change a league rule, a formula, a route, a schema, or a command, update the matching section here in the same change. If something here contradicts the code, the code wins — fix this file. If you discover a constraint the hard way, write it down so the next person doesn't. Do not let this file drift into a changelog: it describes how the project works today, not what changed.

## What this is

A community fantasy league for FIRST robotics. Players draft robots with **Pollen**, a free in-game resource with no monetary value, and earn points from real competition results. Two regional leagues share one website: San Diego FTC and San Diego FRC. Joining and drafting are free. This is an independent community project, not an official FIRST program.

| Environment     | Branch    | Deploys from             |
| --------------- | --------- | ------------------------ |
| Public league   | `main`    | `wrangler.jsonc`         |
| Private staging | `staging` | `staging/wrangler.jsonc` |

Pushes to `main` run checks but **do not** deploy. A public release is a deliberate action: **Actions → Check and deploy → Run workflow**, select `main`, tick `deploy_production`; or push a `production-*` tag pointing into `main` history. Pushes to `staging` do deploy the private Worker.

## Rules you must not break

These protect real participants. Violating one is a defect even if every test passes.

1. **Never change a saved roster.** Submitted rosters freeze their picks, prices paid, team names, catalog version, and receipt. Re-imports, repricing, and refreshes must leave them untouched. People have already created accounts and saved entries.
2. **Never retroactively reprice.** Prices freeze when the first roster of a season is saved. Refreshed results may update prices only while no roster exists.
3. **Separate the leagues.** FTC and FRC have separate data, rosters, prices, budgets, tables, and deployment settings. An FRC change must not touch FTC behaviour, and vice versa.
4. **Enforce everything on the server.** Membership, roles, budget, roster size, eligibility, league, season, and ownership are decided server-side. Browser checks are convenience only; never trust client-supplied prices or totals.
5. **Credentials stay in Cloudflare/GitHub secrets.** Never commit a token, print one in a log, or expose one in a browser response. The Firebase web config is a public app identifier, not a secret.
6. **Never invent competition data.** No fabricated teams, registrations, match scores, OPR values, or event keys. Missing data stays explicitly unmeasured — never zero. Do not infer event keys from event names; use the owner-confirmed keys.
7. **Don't hand-edit `dist/`.** It is generated. Edit `src/`, `web/`, `staging/`, then build.
8. **Don't replay all migrations against existing databases.** They were initialized manually. See [database setup](docs/DEVELOPERS.md#database-setup).
9. **Idempotence.** Repeated syncs and repeated submissions must not duplicate entries or double-count points. An uncertain write leaves a recoverable checkpoint.
10. **Distinguish confirmed from provisional.** A provisional participant field must be labelled as such in the UI and in the API.

## Commands

```bash
npm install          # first run only
npm run format:check # prettier, must pass
npm run check        # build + syntax-check the Worker bundle
npm test             # builds both targets, then node --test
npm run format       # write prettier fixes
```

Run `format:check`, `check`, and `test` before pushing any functional change. `npm test` runs a `pretest` build, so a stale `dist/` is not a failure mode. Local tests use isolated SQLite and never touch remote resources.

## Layout

| Path                             | Contents                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `worker.mjs`                     | Public Worker entry: FTC draft board, submissions, Sheets, recovery      |
| `src/`                           | League access, page assembly, FTC pricing, FRC calculations              |
| `src/frc/`                       | `opr.mjs` (math), `tba.mjs` (provider client), `service.mjs` (API/state) |
| `src/predictions/`               | FTC PP model, historical evaluation, staging Pollen pricing              |
| `web/`                           | Shared templates, browser scripts, styles, logo                          |
| `staging/`                       | Private Worker, league access, admin tools, staging-only tests           |
| `tests/`, `staging/tests/`       | `node:test` suites with local fixtures                                   |
| `data/`                          | Frozen catalog, eligibility lists, prediction evidence with attribution  |
| `migrations/`                    | D1 schema history                                                        |
| `docs/`                          | Developer, admin, league, FTC PP, and FRC documentation                  |
| `build.mjs`, `staging/build.mjs` | esbuild bundling; inlines templates, styles, and assets                  |

Pages are assembled in `src/pages.mjs` by replacing markers (`/* FRC_STYLES */`, `__LEAGUE_LOGO__`, `/* THEME_INIT */`) in the HTML under `web/`. Browser scripts are bundled as string exports and served from `/assets/*.js`.

## San Diego FRC · 2027

Staging-only for review; public FRC drafting stays disabled. Rules: **15 Pollen, one to three different teams, whole-number prices 3–11.** The pool is all San Diego Regional participants.

**Data source.** The Blue Alliance, through a server-side read key (`TBA_AUTH_KEY`). Baseline event `2026casnd`; optional off-season bonus `2026casan1`; target `2027casnd` until the real 2027 event is published. A failed import keeps the last successful data.

**OPR.** Foul-adjusted qualification OPR, computed by this project: least squares over qualification alliances with `foulPoints` subtracted. Playoffs, awards, wins, and advancement are excluded. Needs ≥5 appearances per team and a full-rank schedule.

**Pricing.** `rating = baseline + 0.5 × max(0, offseason − baseline)`, then `price = clamp(ceil(11 × max(0, rating) / M), 3, 11)` where `M` is the highest positive **baseline** OPR. The scale excludes bonuses, so one team's bonus cannot reprice an absentee. No measured baseline → provisional 3 Pollen, never zero.

**Standings — weight classes.** This is the ranking system and _only_ the ranking system:

```text
earned OPR    = sum of a team's finalized OPR at each counted 2027 event
class points  = 100 × max(0, earned OPR) / best earned OPR in the competing class   (capped at 100)
roster points = sum of the class points of a roster's picks
```

- Prices sort the pool into **weight classes**: contiguous Pollen bands, balanced by team count, always leaving one team per class affordable within the budget. A typical field gives Light / Middle / Heavy.
- Every class awards the same 100 points to its strongest earner; classmates score in proportion. The best 3-Pollen team is worth exactly as much as the best 11-Pollen team. Price buys a better chance of leading a class, never a larger award.
- A class pays **once per roster**. Draft two teams from one class and the extra competes in the **dearest** class instead, against the strongest team in the field. The implementation picks whichever arrangement totals highest, so pick order never changes a rank.
- Only robot-game OPR counts. **Awards, wins, and advancement never add points.**
- Absent team → 0. Negative estimate → 0, never a deduction. A class with no positive earner awards nothing.
- Weight classes are derived from the quoted prices at read time. Nothing extra is stored, frozen catalogs keep their classes, and **no migration is involved**.
- **Weight classes must never restrict drafting, reprice a team, or alter a saved roster.** Any roster that was legal before is still legal: 1–3 different teams within 15 Pollen, any combination.

Code: `buildWeightClasses`, `scoreWeightClasses`, and `scoreFrcRoster` in `src/frc/opr.mjs`; applied in `frcSnapshot` in `src/frc/service.mjs`, which is read-only. Full detail in [docs/FRC.md](docs/FRC.md).

## San Diego FTC

87 eligible teams registered for BioBuzz 2026–27; one roster per verified account per season. The public site keeps the legacy tiers of 3, 4, 5, 6, and 11 Pollen. Staging derives whole-number prices from **PP** within 3–11 Pollen, one step per 15 PP, on the same 15-Pollen budget; teams without PP cost a provisional 3 Pollen and stay unscored. The FTC scoring rule adds each drafted team's robot-game OPR after every event; official FTC earned standings are **not implemented yet**. The prediction leaderboard is retired — do not revive it. See [docs/PREDICTIONS.md](docs/PREDICTIONS.md).

PP is a DECODE-scale estimate from historical events. It is experimental, not a calibrated forecast for another season's game, and pricing must never feed back into the model.

## Architecture

Cloudflare Workers serve the site and API. Google Sheets stores the FTC catalog and live entries. Cloudflare D1 stores memberships, roles, archives, audit events, FRC settings/events/rosters, and recoverable write checkpoints. Firebase Authentication provides Google sign-in; accounts must be verified Google accounts holding an invitation. The owner and administrators may switch region and program; moderators and players stay in their assigned league. Only the owner appoints staff or creates leagues.

Submissions and admin mutations share a D1 lock. Do not edit, sort, insert, or delete response rows while a write is pending.

## Testing conventions

- `node:test` with `assert/strict`. Fixtures live in `tests/support/` and `staging/tests/support/`.
- Use clearly labelled synthetic fixtures (`TEST …`). Never submit or modify a real participant entry to test something.
- Cover the boundary you changed: access control, budget, idempotence, frozen prices, migration replay, and rollback are all existing patterns to follow.
- Assert on derived values with a tolerance (`< 1e-8`) — OPR comes out of a linear solve.
- `tests/frc-client.test.mjs` runs `web/frc.js` against a stub DOM built from `web/frc.html`'s real element ids, so a render that reaches for a missing element fails the build. Extend it when you add an element id or change what a view displays.
- Check changed browser flows at desktop and mobile widths.

## Attribution

Code is MIT. Competition data comes from FTCScout, FIRST, and The Blue Alliance; the licence covers this project's code, not third-party data, names, or trademarks. Keep data attribution visible on any page that displays it.
