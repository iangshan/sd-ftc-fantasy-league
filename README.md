# San Diego FTC Fantasy League

A community fantasy league for San Diego FTC teams. Players draft one to three teams within a **15-Pollen budget**; joining and drafting are free.

| Environment                                                                       | Branch    | Experience                                              |
| --------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| [Public league](https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev/)    | `main`    | Released draft board and participant dashboard          |
| [Private staging](https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/) | `staging` | Prediction leaderboard, roster entry, and admin testing |

The repository is public. Staging uses verified Google accounts and invitation-based membership for separate FTC/FRC regional leagues. Only the owner can switch leagues or appoint staff; existing admins retain FTC access. San Diego FRC drafting remains disabled until its rules are decided. See [leagues, invitations, and roles](staging/LEAGUES.md). The `staging/` folder contains public source for the private testing site; GitHub does not support private folders inside a public repository.

## League and predictions

The current pool contains 87 eligible teams registered for BioBuzz 2026–27. Each verified account may submit one roster per season. Public-site prices retain the legacy tiers of 3, 4, 5, 6, and 11 Pollen. Private staging instead derives whole-number prices from PP, within 3–11 Pollen, while retaining the 15-Pollen roster budget. Teams without PP cost a provisional 3 Pollen and remain unscored.

The scoring rule adds each drafted team's robot-game OPR after every event. Awards, wins, and advancement do not add separate points. Official earned standings are not implemented yet.

The staging prediction model estimates **PP per event** from completed DECODE results. Its formula, constants, source data, evaluation procedure, and limitations are public:

- [PP formula and evaluation](docs/PREDICTIONS.md)
- [Prediction model](src/predictions/model.mjs), [historical evaluation](src/predictions/history.mjs), and [staging pricing policy](src/predictions/pricing.mjs)
- [Event-data provenance and refresh procedure](data/predictions/README.md)

Staging pricing currently uses one Pollen step per 15 PP: Rust-eze Robotics costs 4 Pollen, Crow Force 11, Fusion 9, and Runtime Terror 8. Pricing does not change the PP model, and saved rosters retain the prices paid when submitted. See the [pricing formula and roster examples](docs/PREDICTIONS.md#pollen-pricing-in-staging).

The current snapshot contains 388 team/event results from 20 completed events. Seventy eligible teams have PP; 17 remain unscored and can still be drafted. DECODE-scale estimates are experimental and are not calibrated forecasts for a different season's game.

## Architecture

Cloudflare Workers serve the website and API. Google Sheets stores the frozen catalog and active entries. Cloudflare D1 stores account ownership, admin roles, archives, audit events, and recoverable write checkpoints. Firebase Authentication provides Google sign-in; Apple and GitHub integrations remain disabled until configured.

## Repository layout

| Location                                 | Contents                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| [staging/](staging/README.md)            | Private-site Worker, configuration, browser assets, admin tools, and tests  |
| [src/](src/)                             | Shared page assembly and the public PP model in `src/predictions/`          |
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

A public release is a separate action: open **Actions → Check and deploy → Run workflow**, select `main`, and enable `deploy_production`. This checkbox defaults to false; leaving it unchecked runs checks only. An explicitly requested release deploys `wrangler.jsonc` after the checks pass. See [DEVELOPERS.md](docs/DEVELOPERS.md#branches-and-deployment).

The two sites use separate D1 databases, workbooks, and Sheets service accounts. Runtime credentials belong in Cloudflare or GitHub secrets, never in repository files. The Firebase web configuration is a public app identifier, not a private credential.

## Operations

- [Accounts and sign-in](docs/ACCOUNTS.md)
- [Admin roles, roster support, and recovery](docs/ADMIN.md)
- [Private staging, admin access, and rollback](staging/README.md)

Submissions and admin mutations share a D1 lock. An uncertain write keeps a checkpoint so recovery can complete the original operation without creating a duplicate. Do not edit, sort, insert, or delete response rows while a write is pending.

The existing production database was initialized manually. Do not replay migrations against it without checking its schema and migration history. The historical `0002_account_rosters.sql` file is empty; `0004_account_rosters_schema.sql` supplies the account table for new installations and leaves an existing table intact. Staging deployment applies only its additive league schema; production migrations remain manual. Local submission tests use isolated SQLite and do not modify remote resources.

## License and attribution

Project code is available under the [MIT License](LICENSE). FTCScout and FIRST supply third-party competition data; see the [data-source documentation](data/predictions/README.md) for attribution and provenance. The project license does not assert ownership of or relicense third-party data, names, or trademarks.
