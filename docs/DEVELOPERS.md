# Developer workflow

The repository is public and the project code is [MIT licensed](../LICENSE). Contributions use branches and pull requests. Repository access and league admin access are separate; code deployed to a Worker runs with that environment's bindings and secrets.

## Local setup and checks

Run the commands below from the repository root using Node.js 22.13 or later. Paths in this guide are also relative to the repository root. Install the exact dependency versions recorded in `package-lock.json`:

```sh
npm ci
npm run format:check
npm run check
npm test
```

`check` validates the catalog and names, builds the production Worker, and checks its JavaScript syntax. `npm test` first builds both environments, then discovers the repository's Node tests. Tests cover catalog validation, account and staging access, predictions, routing, and roster submissions. The submission fixtures use local SQLite and a memory-only Sheets adapter; they do not write remote entries.

Use `npm run format` to apply the shared Prettier configuration before committing. Dependencies, local runtime state, generated bundles, and canonical prediction-data exports are excluded from formatting. Browser code, HTML, CSS, application modules, maintained catalog data, and documentation remain readable source files.

`npm run dev` builds and starts Wrangler locally. Features that call Firebase or Sheets require the corresponding external configuration; local unit tests do not require those credentials. Store local secrets in an ignored `.dev.vars` file. Do not copy production participant data into a development environment.

## Source layout

| Location                            | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `worker.mjs`                        | Production HTTP handlers, authentication, submissions, and administration   |
| `web/`                              | Shared browser JavaScript, CSS, page templates, and logo                    |
| `src/pages.mjs`                     | Page assembly from maintained browser assets                                |
| `src/predictions/`                  | PP model, historical evaluation, and staging pricing policy                 |
| `data/decode-catalog.json`          | Frozen 87-team DECODE source catalog                                        |
| `data/not-returning.json`           | Historical teams excluded from this season, with reasons                    |
| `data/rookie-teams.json`            | Registered teams missing from the frozen catalog                            |
| `data/predictions/`                 | Prediction evidence and source documentation                                |
| `team-names.json`                   | Current names keyed by team number                                          |
| `staging/`                          | Private-site wrapper, configuration, browser assets, admin tools, and tests |
| `build.mjs` and `staging/build.mjs` | Shared esbuild pipeline and staging asset generation                        |
| `scripts/`                          | Prediction-data import and evaluation tools                                 |
| `tests/` and `tests/support/`       | Shared checks and local fixtures                                            |
| `migrations/`                       | D1 schema history                                                           |
| `docs/`                             | Developer and operating guides                                              |
| `dist/`                             | Generated deployment artifacts, excluded from Git                           |

The staging folder is public source for an access-controlled website; moving files there does not make them private. Both environments build from the same application source. Production exports only the Worker entry point; the staging bundle also exposes the helpers used by its authentication wrapper and tests. Do not edit generated bundles or make regular changes in Cloudflare's quick editor: the next Git deployment replaces them.

## Names and eligibility

To rename a team, edit only its value in `team-names.json`, retaining the team-number key. The file holds 102 names: 87 historical teams and 15 additions for BioBuzz 2026–27. The build rejects missing or unknown numbers and invalid names. Names do not control eligibility, prices, or statistics.

Eligibility is maintained in two data files:

- `data/not-returning.json` removes historical teams from the draft, prediction board, roster validation, and archive restoration.
- `data/rookie-teams.json` adds registered teams absent from the frozen catalog as `[number, "Name"]`. These teams have no invented OPR or rank and use the cheapest price tier. An eligible historical team with no scored DECODE result is also draftable at that tier.

Keep `team-names.json` consistent with additions, and run the checks after editing either file. Compare eligibility against the region registration sheet linked from [sdftc.org](https://www.sdftc.org/2026-27registration.html). Event participation alone does not define registration for a new season.

Name and eligibility changes update the catalog version, so an open draft tab may need to refresh before submission. Current pages show current names; existing receipts and saved snapshots retain the names and prices recorded when submitted. Team number remains the stable identity. The frozen catalog is checked against the private Sheet before current names and eligibility are applied. Staging then applies the PP-based pricing policy from `src/predictions/pricing.mjs` and computes the effective catalog version. The unit comes from the complete eligible pool, not browser filters or planned events. Public pricing and the frozen Sheet stay unchanged; saved receipts, pending checkpoints, and archives retain their paid prices. See [the pricing formula](PREDICTIONS.md#pollen-pricing-in-staging).

## Branches and deployment

Pull requests and pushes to `main` run checks only. The deployment targets are explicit:

| Branch    | Workflow                   | Configuration            | Result                                                    |
| --------- | -------------------------- | ------------------------ | --------------------------------------------------------- |
| `staging` | **Deploy private staging** | `staging/wrangler.jsonc` | Automatic private deployment on push                      |
| `main`    | **Check and deploy**       | `wrangler.jsonc`         | Public deployment only through an explicit manual release |

Start staging work from `staging`, review it there, and open a pull request to the intended branch. Merge reviewed source into `main` to keep the default GitHub branch current. Merging or pushing to `main` does not deploy the public website; the running site may remain on an earlier release. A push to `staging` continues to deploy private testing automatically. Use pull-request review and repository branch rules for both branches.

CI installs the lockfile with `npm ci` and uses the repository checks. The existing `CLOUDFLARE_API_TOKEN` GitHub secret authorizes deployment; Worker secrets remain in Cloudflare. A failed build does not replace the active deployment. No workflow automatically runs production database migrations.

To make an authorized public release through GitHub:

1. Open **Actions → Check and deploy → Run workflow**.
2. Select the `main` branch.
3. Enable the `deploy_production` checkbox, which defaults to false, and run the workflow.
4. Confirm that the checks and **Deploy production** step succeed.

A manual run with the checkbox unchecked runs checks only. The deployment step requires a `workflow_dispatch` event on `main` with `deploy_production: true`; pull requests, pushes, and dispatches on other branches do not deploy production.

Prefer that release workflow for a recorded public deployment. The CLI command `npm run deploy` directly targets production and requires separate, explicit release authorization. For an authorized manual staging deployment after checks pass, use:

```sh
npm run build:staging
npx wrangler deploy --config staging/wrangler.jsonc
```

Staging uses `admin-only` access for the owner and approved admins. The explicit two-admin synchronization requires D1 permission on the Actions token and must succeed before its deployment proceeds. See [Staging guide](../staging/README.md) for the synchronization procedure, owner-only access rollback, resource isolation, and original-board rollback switch.

## Database setup

To initialize a fresh local development database without touching Cloudflare's remote database:

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

The empty historical `0002_account_rosters.sql` is retained for migration history; `0004_account_rosters_schema.sql` supplies the missing account table for fresh installations. Production and staging were initialized manually before this repair. Inspect their schema and migration history before any remote migration; do not replay the original unguarded migrations against an existing database. Builds and deployments do not migrate remote D1 automatically.

## Review a change

Explain the changed behavior and relevant validation in the pull request. For browser changes, check the affected pages at desktop and mobile widths. For account or submission changes, exercise the local fixtures and use clearly labeled staging test entries if a live integration check is needed. Never reset another player's roster to test code.

Keep credentials, service-account JSON, private response rows, participant exports, and personal admin identifiers out of commits and public workflow logs. Report sensitive account or access issues privately to the repository owner rather than posting private data in a public issue.
