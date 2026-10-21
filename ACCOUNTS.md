# League accounts

Firebase Authentication project: `ftc-fantasy-league` (Spark/free). Sign-in is federated only: Google, Apple, and GitHub. Email/password sign-in and registration are disabled; existing account records and rosters are retained. Analytics, Firebase Hosting, and paid services are not needed. The public web configuration in the Worker is an app identifier, not a service-account credential. Never place the Sheets service-account key in client code.

Cloudflare continues to host the site and private roster ownership in D1. `/dashboard` is the participant dashboard. Firebase handles token refresh and federated sign-in. The Worker validates every account API token through Google's authenticated account lookup, checks its expected project and uid, and rejects disabled or revoked sessions. Email verification is required to submit.

Apply `migrations/0002_account_rosters.sql` to the existing D1 database before deploying this version. This migration was applied manually through the Cloudflare console on 2026-10-20. It is idempotent. Do not replay `0001_write_locks.sql` on this existing database.

Roster ownership is bound to the authenticated Firebase uid and season. Client-supplied names, email, Discord, uid, and submission tokens cannot select an owner. A server-generated submission token and the existing write lock coordinate the Sheets row and D1 ownership snapshot. The ownership checkpoint is persisted before attempting a Sheets write and remains until both stores confirm success. Users can recover only their own pending entry after two minutes. Organizer recovery also records account ownership. The saved roster keeps the names and prices from submission time.

Existing submissions made before accounts existed have no authenticated owner. Do not automatically assign them based on a matching name, email, or Discord string. Verify ownership with the organizer before a manual migration. The existing Google Sheets response columns are unchanged.

The dashboard offers Google, Apple, and GitHub sign-in. Each creates a league account automatically on first use and requests basic identity only: Apple with the `email` and `name` scopes, GitHub with `user:email`. The authorized production domain is `sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev`. If a custom domain is added, add its exact hostname in Firebase Authentication → Settings → Authorized domains.

## Enabling the sign-in providers

This is a two-step switch, and both steps are required.

1. Turn the provider on in Firebase Authentication → Sign-in method.
2. Set its flag to `true` in `enabledProviders` in `worker.mjs`, then deploy.

`enabledProviders` is served to the dashboard by `/api/auth/config`. A provider left `false` renders a disabled button labelled "Not available yet" instead of letting a player tap it and hit `auth/operation-not-allowed`. As of 2026-10-20 the live project has Google enabled and Apple and GitHub unconfigured, so the flags are `{ google: true, apple: false, github: false }`. Verify the Firebase side before flipping a flag:

```
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=<apiKey>" \
  -H 'Content-Type: application/json' \
  -d '{"providerId":"apple.com","continueUri":"https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev/dashboard"}'
```

An `authUri` in the response means the provider is live; `OPERATION_NOT_ALLOWED` means it is not configured yet. The `apiKey` is the public web config already in `worker.mjs`.

- **Apple** requires a paid Apple Developer Program membership. Create a Services ID and a Sign in with Apple private key, then give Firebase the Services ID, Team ID, Key ID, and key. Add Firebase's OAuth callback URL to the Services ID's Return URLs. Apple accounts arrive with a verified email, which may be an `@privaterelay.appleid.com` address that forwards to the player.
- **GitHub** requires a GitHub OAuth app. Paste its Client ID and secret into Firebase and set the app's Authorization callback URL to the one Firebase shows. GitHub identities arrive **unverified**, so those players must use **Send verification email** and **I've verified my email** on the dashboard before they can submit a roster. The server enforces this; it does not special-case any provider.

Firebase's default "one account per email address" setting means a player who first signs in with Google and later picks GitHub with the same address gets `auth/account-exists-with-different-credential`. The dashboard tells them to use the option they signed in with originally. Roster ownership is keyed on the Firebase uid, so two providers on one email are two separate league accounts unless they are linked; do not link them without confirming identity with the organizer.

Submissions are enabled and the draft is open. The old Apps Script deployment is archived. Administration uses verified Firebase roles at `/admin`; no organizer password is needed. Scoring is not configured; dashboard copy explicitly says no points or standings are assigned. The previous hostname has been removed from Firebase authorized domains.

Validation: 20 local checks cover project/token rejection, email verification, account isolation, duplicate submission prevention, uncertain-write recovery, immutable roster snapshots, and cross-origin rejection. Live account sign-in and dashboard verification are recorded separately in the project handoff state.
