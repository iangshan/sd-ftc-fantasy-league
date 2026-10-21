# Developer workflow

## Edit a team name in GitHub

1. Open `team-names.json` and click the pencil (Edit).
2. Change only the name to the right of a team number. Keep the number, quotation marks, and commas. For example, change `"10809": "Crow Force"` to `"10809": "Updated Team Name"`.
3. Create a branch and pull request so another developer can review the change. Merge to `main` when ready to publish.
4. After GitHub Actions → Check and deploy succeeds, refresh the website and search for that team number.

`team-names.json` includes all 87 frozen source teams, including excluded/unavailable ones. Renaming an excluded team does not make it eligible. The draft still has 81 eligible teams. Do not change team numbers, prices, statistics, or the private Sheet Catalog to rename a team.

Names are applied after the Sheet catalog's integrity check. The board, participant dashboard, and admin entries display the current names. New submissions save the current name. Existing receipts and stored Sheet/D1 snapshots retain the name at submission time; team number remains the identity. A name change updates the catalog version, so someone with an old draft tab may be asked to refresh before submitting.

## Build and deploy

- `worker.mjs`: application source, with a marked team-name configuration slot.
- `team-names.json`: editable names keyed by team number.
- `build.mjs`: validates the names and creates `dist/worker.mjs`.
- `wrangler.jsonc`: deploys the generated file to the existing Worker and binds the existing D1 database.
- `npm install` then `npm run check`: validates names and JavaScript syntax.
- `npm run deploy`: validates, builds, and deploys with an authenticated Cloudflare account.

Do not edit `dist/worker.mjs`; it is regenerated. Do not use the Cloudflare quick editor for regular changes after Git deployment is connected, because the next deployment replaces those edits. Keep source changes in GitHub.

GitHub Actions runs `.github/workflows/deploy.yml`: pull requests run checks only; pushes to `main` build and deploy. Other branches do not deploy. The repository secret `CLOUDFLARE_API_TOKEN` authorizes deployment, and the account ID is in the workflow. No production migration command runs during a build. Secrets already stored on the Worker remain on Cloudflare. A failed build leaves the previous deployment active. You can rerun a failed workflow from the Actions tab after correcting its cause.

## Invite developers

The repository stays private in iangshan's personal account. The owner opens Settings → Collaborators → Add people, searches each person's GitHub username, and sends an invitation. The developer must accept it. GitHub may ask the owner to confirm their password first.

Collaborators can modify repository code. Once production Git deployment is enabled, code merged or pushed to `main` changes the live Worker, so invite trusted developers. Repository access does not automatically grant a league admin role or direct access to Firebase, Cloudflare, or the private workbook. However, deployed server code runs with the Worker's data access; treat production code access as trusted access.

Use pull requests and review before merging. No branch protection or paid GitHub features are required by this setup. Anyone with write access can still push directly unless the owner enables enforceable branch protection for this repository.

## Checks after a change

Check the deployment result, the public draft board (81 available teams), Google-only sign-in, and the participant dashboard. For changes to submission or recovery behavior, use the documented TEST roster workflow in README.md; never reset a real player's roster as a test. Existing account/security tests remain in the development workspace.

No credentials, Google service-account JSON, participant exports, or private response rows belong in Git. Do not rerun production database migrations; see README.md for the existing manual migration history.
