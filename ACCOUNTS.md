# League accounts

Firebase Authentication provides identity for the league; Cloudflare D1 binds each roster to a Firebase UID and season. `/dashboard` displays the participant's saved roster and account status.

Google sign-in is enabled. Apple and GitHub integrations exist but remain disabled in `enabledProviders` until their Firebase settings are configured. Email/password sign-in is disabled. Public Firebase web configuration identifies the app; it is not a service-account credential.

## Server verification

Every account API request verifies its ID token through Google's `accounts:lookup` service. The server checks the expected Firebase project, issuer, UID, timestamps, and revocation state. Disabled or deleted accounts are rejected. A verified email is required to submit a roster.

The token's sign-in provider is trusted only after Google validates the token for the same UID. Private staging additionally requires a **Google sign-in**, a verified email, and either the pinned owner UID or an active staging admin role under its `admin-only` configuration. [STAGING.md](STAGING.md#admin-access) describes the guarded two-admin synchronization and the `owner-only` rollback mode. Linking a Google account does not make a session authenticated through a different provider eligible for staging.

Client-provided names, email addresses, roles, UIDs, and submission tokens cannot choose a roster's owner. The submission service derives ownership and its idempotency token from the authenticated UID and season.

## Saving and recovering a roster

One account may save one roster per season. The service records an ownership checkpoint before writing to Sheets and retains it until both Sheets and D1 confirm the save. Repeating an already-completed request returns the original receipt rather than creating another entry.

A participant can check an interrupted save in My dashboard after the recovery delay. An admin can also recover it through the admin dashboard. Recovery verifies the expected response row before writing. Saved snapshots retain the names and prices recorded at submission time.

Legacy entries created before account ownership was introduced require an explicit admin link. A matching name, email, or Discord contact alone is not proof of ownership.

## Provider configuration

To enable another provider:

1. Configure it in Firebase Authentication → Sign-in method.
2. Set its entry in `enabledProviders` to `true` in `worker.mjs`.
3. Verify the callback and authorized domains, test the flow, then deploy the intended environment.

A disabled provider appears as **Not available yet**. Apple requires its own developer configuration and credentials; GitHub requires an OAuth application. Keep provider secrets in Firebase, not in browser code or Git.

Firebase's account-per-email policy can reject a different sign-in provider with `auth/account-exists-with-different-credential`. Ask the player to use their original sign-in option. Do not link identities or move a roster without verifying ownership.

The production and staging hostnames must each be authorized in Firebase. Identity is shared between environments, while roster and admin records are stored separately. Signing in to one hostname does not create the other site's session cookie.

## Database and testing

Production account storage was initialized manually on 2026-10-20, and staging account storage was initialized separately. The historical `0002_account_rosters.sql` is empty and retained for migration history. `0004_account_rosters_schema.sql` creates the account table if missing, making the full migration sequence usable for a fresh database. Inspect the existing schema and migration history before changing an existing database; deployments do not automatically apply remote migrations.

The repository includes tests for authentication boundaries, account isolation, idempotent submissions, invalid rosters, and interrupted-save recovery. Local submission tests use SQLite and a memory-only Sheets adapter. A passing local suite does not establish that another user's live Google sign-in has been performed; Google validates that user's session when they sign in.
