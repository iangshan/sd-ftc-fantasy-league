# San Diego FTC Fantasy League — Cloudflare deployment

This is a standalone, bundled release of the working website. Google Apps Script is not required. The same Google response workbook remains the record of teams, settings and entries. No credentials or participant responses are included.

## Upload to GitHub

1. Create a **private** GitHub repository named `sd-ftc-fantasy-league`.
2. Extract the ZIP. Upload its contents, not the ZIP itself. `package.json`, `wrangler.jsonc` and `worker.mjs` must appear at the repository's top level; include the `migrations` folder too.
3. In Cloudflare, choose **Workers & Pages → Create application → GitHub**, then select the repository.
4. Worker name: `sd-ftc-fantasy-league`; root directory: repository root; build command: leave blank; deploy command: `npm run deploy`.
5. Deploy. The first version works as a team-picker preview. Submissions are disabled until the existing Google Sheet is connected.

Cloudflare can automatically deploy later pushes to your selected production branch. This release has no separate frontend build step. `worker.mjs` bundles all website assets and backend modules so it is easy to deploy; the editable multi-file project remains the source for future releases.

## Connect Google Sheets

The code expects the existing PRIVATE response workbook with `Catalog`, `Responses`, and `Settings` tabs. The old Apps Script property `DRAFT_RESPONSE_SPREADSHEET_ID` identifies it. Do not substitute the public Fantasy Stats workbook or make response data public.

1. Create a Google Cloud service account and enable the Google Sheets API. Share the private response workbook with the service account email as Editor. A project-wide IAM role or domain-wide delegation is not needed.
2. In the Worker's **Settings → Variables and Secrets**, add these as runtime **secrets**, not build variables:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the service account key JSON.
   - `RESPONSES_SHEET_ID`: the existing private response workbook ID.
   - `ADMIN_PASSWORD`: a unique random password of at least 24 characters.
3. Keep the Google private key out of GitHub and chat. The secret is used only by the server, not by visitors.
4. Visit `/organizer`; sign in with username `organizer` and the admin password. Check that existing entries and prices are correct. Participant details are not exposed by the public draft API.

## Coordinate simultaneous saves

Google Sheets remains the record; a small Cloudflare D1 table is used only to coordinate in-flight writes and recover interrupted saves.

1. In Cloudflare's **D1 SQL database** page, create `ftc-draft-coordination`.
2. Open its **Console**, paste the contents of `migrations/0001_write_locks.sql`, and execute it ONCE on this new empty database.
3. Copy its database ID. In `wrangler.jsonc`, add this top-level field, replacing the placeholder with the actual ID:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ftc-draft-coordination",
    "database_id": "YOUR_ACTUAL_DATABASE_ID",
    "migrations_dir": "migrations"
  }
]
```

The database ID is configuration, not a password. Commit the change to GitHub and let Cloudflare redeploy it. Keep this binding in the configuration file so future Git deployments preserve it. The SQL table created in the dashboard is not tracked by Wrangler migrations; do not replay that same creation migration through the CLI on this database.

## Enable live entries

1. Archive the old Apps Script web-app deployment so it cannot accept submissions at the same time. Keep its code and spreadsheets.
2. Verify the organizer page reads the existing workbook successfully and the DB binding is present.
3. Change `SUBMISSIONS_ENABLED` in `wrangler.jsonc` to `"true"`, commit, and redeploy.
4. Use the organizer page to open the draft. Submit one identified test entry and check its exact row and receipt in the same Google Sheet before sharing the site.
5. Avoid inserting, deleting, sorting, or manually editing response rows while entries are being saved; use filter views for inspection. Live team prices are intentionally frozen and catalog edits require a matching price-version update.

An uncertain Sheets write keeps a checkpoint until the participant retries or the organizer uses **Check interrupted save** after two minutes. Recovery checks the same row instead of appending a duplicate. Completed entries are stored in the response workbook.

## Add a domain

After the free `workers.dev` site works, select the Worker and open **Domains**. Search for and purchase a domain through Cloudflare Registrar, reviewing the price, term, contact details and renewal settings, then connect it. If you already own a domain, add it to Cloudflare first and add it as the Worker's Custom Domain. Cloudflare configures DNS and HTTPS for a Worker Custom Domain.

If Wrangler warns that a later Git deployment will remove a dashboard-configured domain, add it to `wrangler.jsonc` as a top-level `routes` array, using your actual purchased hostname:

```json
"routes": [{ "pattern": "YOUR_DOMAIN", "custom_domain": true }]
```

## Validation and limits

The source passed 19 backend regression tests, type checking, a production build, and Cloudflare packaging checks. This bundle is derived from that source. Live Google authorization, a real response write and browser behavior still need to be checked in the configured account. This ZIP does not contain a working Google connection and does not create a Cloudflare account or buy a domain.

Official guidance:
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.google.com/workspace/guides/create-credentials
- https://developers.cloudflare.com/changelog/post/2026-05-14-domains-tab/
