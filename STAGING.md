# Private staging

Private site: https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/

Sign in with the league owner's existing Google account. The server checks the verified Firebase UID against the league owner before serving any league page, asset or API. Other admins and repository collaborators cannot view the site with their own accounts. People who can modify deployment code remain trusted: they can change these controls.

## Make and review changes

1. Select the `staging` branch in GitHub before editing `worker.mjs` or `team-names.json`.
2. Commit changes to `staging`. The **Deploy private staging** action checks and deploys only the staging Worker.
3. Review changes on the private site. Its green banner identifies the test environment.
4. When ready to publish, open a pull request from `staging` to `main`, review it, then merge. The existing production action deploys `main` to the public site.

Changes to `staging` do not update the public site. Direct pushes to `main` still publish immediately. Do not merge unfinished work. The owner-only [Prediction home page](https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev/) replaces the draft board as the primary roster-entry flow. Navigation contains Prediction, My dashboard, and Admin; `/prediction` and `/admin/predictions` remain aliases. The page lists all 87 eligible teams by default, including 70 with PP and 17 unscored teams that can still be drafted. It reads current prices, eligibility, opening status, and the price version from `/api/draft`, then saves through the existing authenticated `/api/submit` service. Successful entries receive the actual server receipt and appear in My dashboard. PP outages do not prevent eligible teams from being drafted; unavailable draft/account data blocks submission. The formula, source, and validation limitations are documented in [PREDICTIONS.md](PREDICTIONS.md). This remains private staging, with isolated test entries and no production changes.

## Restore the original draft board

The original draft page is preserved in the unchanged `worker.mjs`; the staging wrapper selects which page to serve. To restore it, set `vars.STAGING_DRAFT_VIEW` to `"legacy"` in `wrangler.staging.jsonc`, run the checks below, then commit and push that configuration to `staging`. The original home page and Draft board navigation return; the prediction aliases remain available for testing. Set the value back to `"prediction"` to re-enable the new home page. This switch requires no database or workbook changes and preserves all saved rosters. Commit `722edef16bbd7d02c76ca71514c55fcfdccf2230` also records the complete version before the home-page replacement.

## Isolated resources

- Worker: `sd-ftc-fantasy-staging`.
- Configuration: `wrangler.staging.jsonc`. Production continues using `wrangler.jsonc`.
- D1: `ftc-draft-staging`, ID `0ab567de-9d00-41be-86f9-a42901986063`.
- Workbook: https://docs.google.com/spreadsheets/d/1Md_Ys5uf9x4kka_ltkTPM5SkHnJZAv9VUGkhnheBRJE/edit
- Google service account: `ftc-fantasy-staging-sheets@smooth-elysium-442100-j6.iam.gserviceaccount.com`. It has no project roles and Editor access only to the test workbook. Its key belongs only in this Worker's `GOOGLE_SERVICE_ACCOUNT_JSON` secret, never in Git.
- Firebase sign-in identity is shared so the existing owner account works. Rosters, admin records, write locks and audit events use the separate staging D1 and Sheet. No production participant data was copied.

The staging database was initialized once on 2026-10-22 using the existing application schema, including `account_rosters`. The downloaded `0002_account_rosters.sql` was empty; staging initialization used the original schema from the development workspace. Never replay migrations on production.

## Build and safeguards

Run `npm run check`, `node build-staging.mjs`, `node --check staging-predictions-client.js`, and `node --test staging.test.mjs prediction.test.mjs staging-navigation.test.mjs prediction-history.test.mjs scripts/import-prediction-history.test.mjs staging-submit.test.mjs`. Deploy with `npx wrangler deploy --config wrangler.staging.jsonc` only after those pass. The submission regression tests use Node 22's in-memory SQLite and a memory-only Sheets adapter; they never write live entries.

The production source is not forked into a second application. The staging build uses the same `worker.mjs` and names, with a separate authentication wrapper. Production builds do not include that wrapper. Version preview URLs are disabled, alternate hostnames fail closed, all staging responses are private/no-store and noindex, and the server rejects an unexpected workbook ID.

Staging uses a host-only, Secure, HttpOnly session cookie. Google validates the token and owner identity on each protected request. Sessions expire after roughly an hour and renew while signed in. Use **Leave staging** to sign out. Cloudflare Access was not activated because its onboarding required billing details and overage authorization.
