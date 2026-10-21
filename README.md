# San Diego FTC Fantasy League

Live website: https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev/

Participant dashboard: `/dashboard`. Administration: `/admin`.

Cloudflare hosts the website and API. Google Sheets stores active entries and the frozen team catalog. D1 stores account ownership, admin roles, archives, audit events, and recoverable write checkpoints. Firebase Authentication handles Google and email/password sign-in.

## Current release

- Draft open; $15 fictional budget; one to three teams; 82 eligible teams.
- Definitely Human #19743 and Mech-A-Mind #23673 are excluded by the server. The original 87-row Catalog tab remains intact for integrity validation. Do not delete those source rows directly.
- Statistics are the frozen DECODE dataset. BioBuzz scoring and standings are not configured yet.
- Verified email required to submit. One roster per Firebase account and season; duplicate Discord contacts rejected.
- The verified owner can appoint/revoke admins. See [ADMIN.md](ADMIN.md) for roster reset, restore, linking, draft controls, and recovery. `/organizer` redirects to `/admin`; its old Basic-auth API is disabled. No admin password is required.
- The old Apps Script deployment is archived to avoid simultaneous writers.

## Runtime configuration

`wrangler.jsonc` binds the existing `ftc-draft-coordination` D1 database as `DB` and sets `SUBMISSIONS_ENABLED` to `"true"`. Cloudflare runtime secrets are `GOOGLE_SERVICE_ACCOUNT_JSON` and `RESPONSES_SHEET_ID`. Never commit credentials or participant exports. Firebase public web configuration is an app identifier, not a private key.

The private workbook contains `Catalog`, `Settings`, and `Responses`. The service account has Editor access to that workbook, with no project-wide role. The admin draft switch changes `Settings!B2`; both it and `SUBMISSIONS_ENABLED` must permit submissions. Public API responses contain no participant details.

## Deployment and database history

Automatic Git builds are **not connected**. A commit alone does not update production. The current workflow commits `worker.mjs`, deploys that same bundle in the Cloudflare editor, and verifies the live website. For an intentionally configured local deployment, `npm install` and `npm run deploy` use the checked-in Wrangler configuration and existing runtime secrets. Verify bindings before deploying.

All three migrations were applied manually to production on 2026-10-20. Do not blindly run migrations against the existing database: `0001_write_locks.sql` is not idempotent, and manual migration history is not tracked by Wrangler. Tables: `write_locks`, `account_rosters`, `league_members`, `league_admins`, `admin_audit`, `roster_archives`. For a new empty database, apply migration files in order.

`worker.mjs` is the deployable bundle; serialized account/admin clients are near its end. Run `npm run check` after edits. The development workspace retains the modular builder and regression tests.

## Testing and recovery

Use a clearly labeled TEST roster. Check receipt, teams, total, and remaining budget in Sheets and the signed-in dashboard. Reset the test through `/admin` when finished. Recoverable archives and audit records intentionally remain. Do not reset another player as a test.

Roster writes and admin mutations share a D1 lock. Uncertain writes retain a checkpoint. After two minutes, participants may recover their own submissions or an admin may use **Check interrupted save**. Recovery verifies the original row to prevent duplicates. Do not sort, insert, delete, or manually edit response rows during a pending save. Use filter views for inspection.

Admin health should show Sheets connected, submissions enabled, draft open, and save queue clear. Inspect Cloudflare error metrics during rollout. This release serializes writes and is subject to Google Sheets quotas; it has not been stress-tested for a large simultaneous audience.

The free subdomain is `sdftcfantasyleague.workers.dev`. The old name-based address is retired. When changing the hostname, replace its exact authorized domain in Firebase Authentication settings. Users must sign in at the new origin; accounts and rosters remain unchanged.

The current Sheets service-account key expires 2027-10-20. Rotate it before expiry and update the Worker secret. Analytics and paid Firebase services remain off.
