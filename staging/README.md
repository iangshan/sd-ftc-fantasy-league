# Staging website

[Open the private staging site](https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/).

Staging uses verified Google sign-in and invitation-based league membership with `STAGING_LEAGUES_ENABLED="true"`. The owner and league administrators can switch between every region and program; moderators and players stay in their assigned league. Previously approved admins retain FTC access. San Diego FRC provides a 2027 test draft priced from 2026 REBUILT, enabled by `STAGING_FRC_ENABLED="true"`. See [FRC setup and the TBA connection](../docs/FRC.md) and [league setup, invitations, and roles](LEAGUES.md).

This folder is public source for the private website. GitHub folder names do not create access restrictions; the deployed Worker enforces them.

## Folder layout

| Path                                         | Purpose                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `worker.mjs`, `access.mjs`, `navigation.mjs` | Staging entry point, Google/admin access checks, and navigation    |
| `pricing.mjs`                                | Current Pollen pricing without a leaderboard API                   |
| `leagues.mjs`, `migrations/`                 | Compatibility export of shared league service, and isolated schema |
| `build.mjs`                                  | Build staging from the shared application and local browser assets |
| `wrangler.jsonc`                             | Staging Worker, isolated bindings, and feature switches            |
| `web/`                                       | Login, banner, and league-management assets                        |
| `scripts/`                                   | Guarded admin synchronization and token-access diagnostics         |
| `tests/`                                     | Staging access, navigation, submission, and synchronization checks |

Paths in this table are relative to `staging/`. Commands and other file paths below are relative to the repository root.

## Make and review changes

1. Start from the `staging` branch and edit the maintained source files listed in [DEVELOPERS.md](../docs/DEVELOPERS.md).
2. Run the checks, review the diff, and push to `staging`. **Deploy private staging** deploys only the staging Worker.
3. Review the private site. Its green banner identifies the test environment.
4. Open and review a pull request from `staging` to `main` to update the default GitHub branch. Merging runs checks without deploying the public Worker.
5. When a public release is separately authorized, open **Actions → Check and deploy → Run workflow**, select `main`, and enable `deploy_production`. It defaults to false; an unchecked run performs checks only.

Pushes to `staging` deploy private testing. Pushes and merges to `main` update reviewed source and run checks while the public site stays on its current release. The [manual release workflow](../docs/DEVELOPERS.md#branches-and-deployment) controls public deployment.

Within San Diego FTC, the **Draft board** at `/` is the roster-entry page. It supports all 87 eligible teams, a 15-Pollen budget, and one to three picks. Navigation includes **Leagues & access** for the owner and **Manage league** or **My league** for other roles. FRC and new regional leagues retain their separate setup workspace with drafting disabled.

The page reads current prices, eligibility, draft status, and catalog version from `/api/draft`, then saves through the authenticated `/api/submit` service. Successful entries receive the real server receipt and appear in My dashboard. Unavailable draft or account state pauses submission. See [PREDICTIONS.md](../docs/PREDICTIONS.md) for the formula and its validation limits. Staging entries use isolated test storage.

Staging prices now follow PP: divide a team's PP by the shared unit, round up, and keep the result between 3 and 11 Pollen. The current unit is 15, computed from the highest PP in the complete eligible pool; missing PP receives a provisional cost of 3 without an invented score. Rust-eze Robotics costs 4 Pollen, Crow Force 11, Fusion 9, and Runtime Terror 8. The [full pricing rule](../docs/PREDICTIONS.md#pollen-pricing-in-staging) and [implementation](../src/predictions/pricing.mjs) are public.

The policy runs on the server after the raw legacy Sheet catalog passes validation. Its effective catalog version ensures an old price quote refreshes before a new submission. Public-site prices and frozen Sheet data remain unchanged. Existing receipts, pending saves, and archives retain their original paid prices; no entry is reset or repriced.

## Admin access

Use **Leagues & access → League members** to manage current staging access, or create a staff invitation to add someone new. Region moderators can join through a single-use link without supplying their email in advance; administrator invitations require their Google email. Only the owner can assign administrators and region moderators. This applies while the league feature is enabled. [LEAGUES.md](LEAGUES.md) documents invitations, role boundaries, and revocation behavior.

The older two-admin synchronization below is retained for historical provisioning. It is not the normal way to add staff now, and its expected-count checks stop it when new FTC administrators exist. The following legacy access behavior applies only with `STAGING_LEAGUES_ENABLED="false"`.

To refresh approved admin access:

1. The existing Cloudflare API token needs **Account → D1 → Edit** for the same Cloudflare account alongside its Worker deployment permissions. If replacing the token, update the repository's `CLOUDFLARE_API_TOKEN` Actions secret directly; never commit or post the token.
2. Confirm `vars.STAGING_MODE` is `"admin-only"` in `staging/wrangler.jsonc` and run the repository checks.
3. Push the reviewed change to `staging` with `[sync-staging-admins]` in the head commit message. The workflow runs `staging/scripts/sync-admins.mjs --apply --expected-count=2` before deployment.
4. Confirm that the guarded two-account synchronization and staging deployment both succeed, then have the admins sign in with their existing Google accounts. A failed synchronization stops deployment and leaves the previous deployment active.

`STAGING_MODE="admin-only"` requires all of the following on every protected request:

- A valid Firebase token verified through Google, with a verified email.
- A session authenticated through `google.com`.
- The pinned owner UID or a current role in staging's `league_admins` table.

A Google-linked account signed in through another provider does not qualify. Staging rechecks roles on each request, so removing a staging role revokes that admin's access immediately. A database failure blocks non-owner access rather than granting it.

`staging/scripts/sync-admins.mjs` copies the currently approved production admins into staging. It reads only production admin roles and their minimal verified member records, then inserts any missing identities and roles in staging. Matching existing records are preserved; conflicting account records stop the operation. It does not copy rosters, participant responses, or production secrets, and the staging Worker has no production D1 binding.

Synchronization is explicit, not part of every deployment. The staging workflow runs it only when the deployed commit message contains `[sync-staging-admins]`, using `--apply --expected-count=2`. The expected count must match the two approved non-owner admins. An unexpected existing staging admin causes the operation to stop before writes so the owner can review the roles. Without `--apply`, the script checks the inputs without changing staging.

The copy is a snapshot, not ongoing synchronization. The script only adds missing approved records; it never silently revokes admins. A later production role change does not change staging access. Remove a staging role through **Admin access** when revocation is needed, and review both environments before requesting another synchronization. An admin who remains authorized in production would be granted staging access again by a later synchronization.

Stored verification records establish which accounts to grant; they do not substitute for a live sign-in. Google validates each admin's actual token when that person signs in. Local tests do not claim that either person's live browser session has been exercised.

To temporarily restrict staging to the owner, set `vars.STAGING_MODE` to `"owner-only"`, run the checks, then commit and push to `staging` without the synchronization marker. This rollback still requires the owner's verified Google session and leaves staging admin records and rosters intact. Restore `admin-only` only after reviewing the approved roles; use the guarded synchronization when those records need to be refreshed.

## Removed prediction leaderboard

The prediction leaderboard, browser assets, roster forecast API, and scenario calculator have been removed. Old `/prediction` and `/admin/predictions` bookmarks redirect to the current league home after authentication. `/api/admin/predictions` and `/assets/predictions.js` return 404 for authenticated requests. `STAGING_DRAFT_VIEW` no longer selects a prediction page.

The FTC board uses the maintained page in `web/legacy-draft.html`, styles in `web/league.css`, and client in `web/draft.js`. Staging adds filters for every current price from 3 through 11. The existing pricing model remains solely to preserve Pollen costs; its formula and evidence remain public in [PREDICTIONS.md](../docs/PREDICTIONS.md). The removed leaderboard is recoverable from Git history before this change.

## Isolated resources

| Resource               | Staging value                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Worker                 | `sd-ftc-fantasy-staging`                                                                                     |
| Configuration          | `staging/wrangler.jsonc`                                                                                     |
| D1 database            | `ftc-draft-staging` (`0ab567de-9d00-41be-86f9-a42901986063`)                                                 |
| Workbook               | [Staging workbook](https://docs.google.com/spreadsheets/d/1Md_Ys5uf9x4kka_ltkTPM5SkHnJZAv9VUGkhnheBRJE/edit) |
| Sheets service account | `ftc-fantasy-staging-sheets@smooth-elysium-442100-j6.iam.gserviceaccount.com`                                |

The Sheets service account has no project roles and Editor access only to the test workbook. Its key belongs in the staging Worker's `GOOGLE_SERVICE_ACCOUNT_JSON` secret. Firebase identity is shared, while rosters, admin records, write locks, and audit events use staging's separate D1 and Sheet. The explicit admin synchronization copies only the account metadata needed for access and the admin directory.

Staging was initialized on 2026-10-22 using the existing application schema, including `account_rosters`. The empty historical migration `0002` remains in the repository; migration `0004` supplies that table for fresh installations. The staging workflow applies `staging/migrations/0001_leagues.sql` and the additive `migrations/0006_frc_drafting.sql` before deployment. Other historical application migrations remain manual. Inspect existing schema and migration history before applying them.

## Build and safeguards

```sh
npm ci
npm run format:check
npm run check
npm test
```

The test command builds both environments. Local submission tests use SQLite and a memory-only Sheets adapter, with no live entries. For an authorized manual deployment after checks pass, use `npx wrangler deploy --config staging/wrangler.jsonc`.

Both builds share the same application source; production excludes the staging authentication and league-management wrappers. Version preview URLs are disabled, alternate hostnames fail closed, staging responses are private/no-store and noindex, and the server rejects an unexpected workbook ID.

The staging session uses a host-only, Secure, HttpOnly cookie. Google token validation and current league membership checks run on each protected request. The owner and league administrators can choose the league-selection cookie; other users' league is derived from the membership table. Sessions expire after roughly an hour and renew while signed in. Use **Leave staging** to sign out.
