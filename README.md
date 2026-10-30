# FIRST Fantasy League

A community fantasy league for FIRST robotics, with regional FTC and FRC leagues on one website. Players draft robots and earn points from their competition results. Joining and drafting are free; Pollen is a game resource with no monetary value.

| Environment                                                                       | Branch    | Experience                                       |
| --------------------------------------------------------------------------------- | --------- | ------------------------------------------------ |
| [Public league](https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev/)    | `main`    | Released draft board and participant dashboard   |
| [Private staging](https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/) | `staging` | Draft board, regional leagues, and admin testing |

Members join with an invitation and a verified Google account. The owner and league administrators can switch between every region and program; moderators and players stay in their assigned league. Only the owner appoints staff or creates leagues. See [leagues, invitations, and roles](docs/LEAGUES.md).

The repository is public, including the source for private staging. Access to the running staging site is controlled separately; GitHub does not support private folders inside a public repository.

## San Diego FRC · 2027

Private staging includes an FRC draft board, saved test rosters, earned standings, and administrator data controls. The proposed rules are **15 Pollen, one to three teams, and whole-number prices from 3–11**.

The pool is all San Diego Regional participants. Initial prices use foul-adjusted qualification OPR from the **2026 REBUILT** San Diego event, plus half of any positive OPR improvement at Stay Classy Classic. Missing or lower off-season results do not reduce the baseline rating, and the price scale stays anchored to Regional results. Until the provider publishes the 2027 participant list, the board explicitly labels the 2026 field as provisional. Historical results set prices and never count as earned 2027 points.

The Blue Alliance supplies registrations and match scores through a server-side read key. Missing data stays unmeasured. See [FRC setup, formulas, and data validation](docs/FRC.md). FRC drafting on the public website remains disabled during staging review.

## San Diego FTC

The current pool contains 87 eligible teams registered for BioBuzz 2026–27. Each verified account may submit one roster per season. Public-site prices retain the legacy tiers of 3, 4, 5, 6, and 11 Pollen. Private staging instead derives whole-number prices from PP, within 3–11 Pollen, while retaining the 15-Pollen roster budget. Teams without PP cost a provisional 3 Pollen and remain unscored.

The scoring rule adds each drafted team's robot-game OPR after every event. Awards, wins, and advancement do not add separate points. Official FTC earned standings are not implemented yet.

The prediction leaderboard has been removed. Staging keeps the established Pollen costs, derived from the historical DECODE model, while FTC roster entry uses the draft board. The pricing formula, constants, source evidence, and limitations remain public:

- [PP formula and evaluation](docs/PREDICTIONS.md)
- [Prediction model](src/predictions/model.mjs), [historical evaluation](src/predictions/history.mjs), and [staging pricing policy](src/predictions/pricing.mjs)
- [Event-data provenance and refresh procedure](data/predictions/README.md)

Staging pricing currently uses one Pollen step per 15 PP: Rust-eze Robotics costs 4 Pollen, Crow Force 11, Fusion 9, and Runtime Terror 8. Pricing does not change the PP model, and saved rosters retain the prices paid when submitted. See the [pricing formula and roster examples](docs/PREDICTIONS.md#pollen-pricing-in-staging).

The current snapshot contains 388 team/event results from 20 completed events. Seventy eligible teams have PP; 17 remain unscored and can still be drafted. DECODE-scale estimates are experimental and are not calibrated forecasts for a different season's game.

## Architecture

Cloudflare Workers serve the website and API. Google Sheets stores the FTC catalog and active entries. Cloudflare D1 stores memberships, roles, archives, audit events, and recoverable write checkpoints. FRC settings, event results, and rosters use separate D1 tables. Firebase Authentication provides Google sign-in.

## Repository layout

| Location                                 | Contents                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| [staging/](staging/README.md)            | Private-site Worker, configuration, browser assets, admin tools, and tests  |
| [src/](src/)                             | League access, page assembly, FTC pricing, and FRC calculations             |
| [web/](web/)                             | Shared website templates, JavaScript, styles, and logo                      |
| [data/](data/)                           | Catalog, eligibility lists, and prediction evidence with source attribution |
| [docs/](docs/DEVELOPERS.md)              | Developer workflow, accounts, administration, and PP formula                |
| [tests/](tests/)                         | Shared application, model, and migration tests with local fixtures          |
| [scripts/](scripts/)                     | Prediction-data import and evaluation tools                                 |
| [migrations/](migrations/)               | D1 schema history                                                           |
| [.github/workflows/](.github/workflows/) | Automated checks and environment-specific deployment workflows              |

The production entry point, shared build, and production configuration remain at the root as `worker.mjs`, `build.mjs`, and `wrangler.jsonc`. `team-names.json` holds current team names. Builds generate `dist/`, which is excluded from Git.

See [the developer guide](docs/DEVELOPERS.md) for setup, checks, source editing, and contribution workflow.

## Deployment boundaries

Pull requests and pushes to `main` run checks without deploying the public Worker. Reviewed source can be merged into the default `main` branch while the public site continues running its previous release. Pushes to `staging` still deploy the private Worker through `staging/wrangler.jsonc`.

A public release is a separate action: open **Actions → Check and deploy → Run workflow**, select `main`, and enable `deploy_production`. This checkbox defaults to false; leaving it unchecked runs checks only. An authorized release can also be started by pushing a `production-*` tag that points to a commit in `main` history. Both routes run checks, deploy `wrangler.jsonc`, and verify the public pages and anonymous API protections. Ordinary branch pushes do not deploy production. See [DEVELOPERS.md](docs/DEVELOPERS.md#branches-and-deployment).

The two sites use separate D1 databases, workbooks, and Sheets service accounts. Runtime credentials belong in Cloudflare or GitHub secrets, never in repository files. The Firebase web configuration is a public app identifier, not a private credential.

## Operations

- [Accounts and sign-in](docs/ACCOUNTS.md)
- [Admin roles, roster support, and recovery](docs/ADMIN.md)
- [Private staging, admin access, and rollback](staging/README.md)

Submissions and admin mutations share a D1 lock. An uncertain write keeps a checkpoint so recovery can complete the original operation without creating a duplicate. Do not edit, sort, insert, or delete response rows while a write is pending.

The existing databases were initialized manually. Do not replay all historical migrations against them. Staging deployment applies its additive league schema, `0006_frc_drafting.sql`, and the guarded event configuration in `0007_frc_pricing_events.sql`; public releases apply only the regional league bootstrap. See [database setup](docs/DEVELOPERS.md#database-setup). Local submission tests use isolated SQLite and do not modify remote resources.

## License and attribution

Project code is available under the [MIT License](LICENSE). Competition data comes from FTCScout, FIRST, and The Blue Alliance; see the [FTC data sources](data/predictions/README.md) and [FRC guide](docs/FRC.md). The license does not assert ownership of or relicense third-party data, names, or trademarks. This is an independent community project, not an official FIRST program.
