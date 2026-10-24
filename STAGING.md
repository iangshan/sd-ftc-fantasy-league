# Private staging

[Open the private staging site](https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/).

The league owner and approved admins sign in with their existing Google accounts. The server verifies the Google session, verified email, and owner UID or staging admin role before serving league pages, assets, or APIs. Public source access does not grant access to the site.

## Make and review changes

1. Start from the `staging` branch and edit the maintained source files listed in [DEVELOPERS.md](DEVELOPERS.md).
2. Run the checks, review the diff, and push to `staging`. **Deploy private staging** deploys only the staging Worker.
3. Review the private site. Its green banner identifies the test environment.
4. When a public release is authorized, open and review a pull request from `staging` to `main`. Merging deploys the public Worker.

Changes to `staging` leave the public site unchanged. Direct pushes to `main` publish immediately, so unfinished experiments belong on staging.

The **Prediction** leaderboard at `/` is the primary roster-entry page. Navigation contains Prediction, My dashboard, and Admin; `/prediction` and `/admin/predictions` remain aliases. All 87 eligible teams appear, including 70 with PP and 17 unscored teams that remain draftable.

The page reads current prices, eligibility, draft status, and catalog version from `/api/draft`, then saves through the authenticated `/api/submit` service. Successful entries receive the real server receipt and appear in My dashboard. Missing PP does not block an eligible team; unavailable draft or account state pauses submission. See [PREDICTIONS.md](PREDICTIONS.md) for the formula and its validation limits. Staging entries use isolated test storage.

## Admin access

With `STAGING_MODE="admin-only"`, every protected request requires all of the following:

- A valid Firebase token verified through Google, with a verified email.
- A session authenticated through `google.com`.
- The pinned owner UID or a current role in staging's `league_admins` table.

A Google-linked account signed in through another provider does not qualify. Staging rechecks roles on each request, so removing a staging role revokes that admin's access immediately. A database failure blocks non-owner access rather than granting it.

`scripts/sync-staging-admins.mjs` copies the currently approved production admins into staging. It reads only production admin roles and their minimal verified member records, then inserts any missing identities and roles in staging. Matching existing records are preserved; conflicting account records stop the operation. It does not copy rosters, participant responses, or production secrets, and the staging Worker has no production D1 binding.

Synchronization is explicit, not part of every deployment. The staging workflow runs it only when the deployed commit message contains `[sync-staging-admins]`, using `--apply --expected-count=2`. The expected count must match the two approved non-owner admins. An unexpected existing staging admin causes the operation to stop before writes so the owner can review the roles. Without `--apply`, the script checks the inputs without changing staging.

The copy is a snapshot, not ongoing synchronization. The script only adds missing approved records; it never silently revokes admins. A later production role change does not change staging access. Remove a staging role through **Admin access** when revocation is needed, and review both environments before requesting another synchronization. An admin who remains authorized in production would be granted staging access again by a later synchronization.

Stored verification records establish which accounts to grant; they do not substitute for a live sign-in. Google validates each admin's actual token when that person signs in. Local tests do not claim that either person's live browser session has been exercised.

## Restore the original draft board

The original draft page is preserved in `web/legacy-draft.html`, with its CSS and browser behavior in `web/league.css` and `web/draft.js`. The staging wrapper chooses which home page to serve.

To restore the board, set `vars.STAGING_DRAFT_VIEW` to `"legacy"` in `wrangler.staging.jsonc`, run the checks, then commit and push to `staging`. The original home page and Draft board navigation return; prediction aliases remain available. Set the value back to `"prediction"` to restore the new home page. This switch does not change database records, the workbook, or saved rosters. Commit `722edef16bbd7d02c76ca71514c55fcfdccf2230` also preserves the version before the home-page replacement.

## Isolated resources

| Resource               | Staging value                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Worker                 | `sd-ftc-fantasy-staging`                                                                                     |
| Configuration          | `wrangler.staging.jsonc`                                                                                     |
| D1 database            | `ftc-draft-staging` (`0ab567de-9d00-41be-86f9-a42901986063`)                                                 |
| Workbook               | [Staging workbook](https://docs.google.com/spreadsheets/d/1Md_Ys5uf9x4kka_ltkTPM5SkHnJZAv9VUGkhnheBRJE/edit) |
| Sheets service account | `ftc-fantasy-staging-sheets@smooth-elysium-442100-j6.iam.gserviceaccount.com`                                |

The Sheets service account has no project roles and Editor access only to the test workbook. Its key belongs in the staging Worker's `GOOGLE_SERVICE_ACCOUNT_JSON` secret. Firebase identity is shared, while rosters, admin records, write locks, and audit events use staging's separate D1 and Sheet. The explicit admin synchronization copies only the account metadata needed for access and the admin directory.

Staging was initialized on 2026-10-22 using the existing application schema, including `account_rosters`. The empty historical migration `0002` remains in the repository; migration `0004` supplies that table for fresh installations. Deployments do not automatically migrate either remote database. Inspect existing schema and migration history before applying migrations.

## Build and safeguards

```sh
npm ci
npm run format:check
npm run check
npm test
```

The test command builds both environments. Local submission tests use SQLite and a memory-only Sheets adapter, with no live entries. For an authorized manual deployment after checks pass, use `npx wrangler deploy --config wrangler.staging.jsonc`.

Both builds share the same application source; production excludes the staging authentication wrapper and prediction routes. Version preview URLs are disabled, alternate hostnames fail closed, staging responses are private/no-store and noindex, and the server rejects an unexpected workbook ID.

The staging session uses a host-only, Secure, HttpOnly cookie. Google token validation and the current role are checked on each protected request. Sessions expire after roughly an hour and renew while signed in. Use **Leave staging** to sign out.
