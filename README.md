# San Diego FTC Fantasy League

A community fantasy league for San Diego FTC teams. Players draft one to three teams within a **15-Pollen budget**; joining and drafting are free.

| Environment                                                                       | Branch    | Experience                                              |
| --------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| [Public league](https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev/)    | `main`    | Released draft board and participant dashboard          |
| [Private staging](https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/) | `staging` | Prediction leaderboard, roster entry, and admin testing |

The repository is public. The staging website is restricted to the league owner and approved admins using verified Google accounts. A public source repository does not grant access to league accounts, private workbooks, or staging.

## League and predictions

The current pool contains 87 eligible teams registered for BioBuzz 2026–27. Prices are whole-number tiers of 3, 4, 5, 6, and 11 Pollen. Each verified account may submit one roster per season.

The scoring rule adds each drafted team's robot-game OPR after every event. Awards, wins, and advancement do not add separate points. Official earned standings are not implemented yet.

The staging prediction model estimates **PP per event** from completed DECODE results. Its formula, constants, source data, evaluation procedure, and limitations are public:

- [PP formula and evaluation](PREDICTIONS.md)
- [Prediction model](prediction-model.mjs) and [historical evaluation](prediction-history.mjs)
- [Event-data provenance and refresh procedure](prediction-data/README.md)

The current snapshot contains 388 team/event results from 20 completed events. Seventy eligible teams have PP; 17 remain unscored and can still be drafted. DECODE-scale estimates are experimental and are not calibrated forecasts for a different season's game.

## Architecture

Cloudflare Workers serve the website and API. Google Sheets stores the frozen catalog and active entries. Cloudflare D1 stores account ownership, admin roles, archives, audit events, and recoverable write checkpoints. Firebase Authentication provides Google sign-in; Apple and GitHub integrations remain disabled until configured.

Maintained source files are separate from generated bundles:

- `worker.mjs`: HTTP handlers, account checks, submission service, and administration.
- `data/`: frozen catalog and season configuration.
- `web/` and `src/pages.mjs`: readable browser assets and page assembly.
- `team-names.json`: names keyed by team number.
- `staging-*.mjs`, `staging-predictions.html`, and `staging-predictions-client.js`: private staging access and prediction experience.
- `dist/`: generated Worker artifacts, excluded from Git.

See [DEVELOPERS.md](DEVELOPERS.md) for setup, checks, source editing, and contribution workflow.

## Deployment boundaries

Pull requests run checks. Pushes to `staging` deploy only `wrangler.staging.jsonc`; pushes to `main` deploy the public Worker through `wrangler.jsonc`. Merging staging into main is a release decision, not a prerequisite for keeping the repository current.

The two sites use separate D1 databases, workbooks, and Sheets service accounts. Runtime credentials belong in Cloudflare or GitHub secrets, never in repository files. The Firebase web configuration is a public app identifier, not a private credential.

## Operations

- [Accounts and sign-in](ACCOUNTS.md)
- [Admin roles, roster support, and recovery](ADMIN.md)
- [Private staging, admin access, and rollback](STAGING.md)

Submissions and admin mutations share a D1 lock. An uncertain write keeps a checkpoint so recovery can complete the original operation without creating a duplicate. Do not edit, sort, insert, or delete response rows while a write is pending.

The existing production database was initialized manually. Do not replay migrations against it without checking its schema and migration history. The historical `0002_account_rosters.sql` file is empty; `0004_account_rosters_schema.sql` supplies the account table for new installations and leaves an existing table intact. Deployment does not automatically run remote migrations. Local submission tests use isolated SQLite and do not modify remote resources.

## License and attribution

Project code is available under the [MIT License](LICENSE). FTCScout and FIRST supply third-party competition data; see the [data-source documentation](prediction-data/README.md) for attribution and provenance. The project license does not assert ownership of or relicense third-party data, names, or trademarks.
