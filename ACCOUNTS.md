# League accounts

Firebase Authentication project: `ftc-fantasy-league` (Spark/free). Google is the only enabled sign-in provider. Email/password sign-in and registration are disabled; existing account records and rosters are retained. Analytics, Firebase Hosting, and paid services are not needed. The public web configuration in the Worker is an app identifier, not a service-account credential. Never place the Sheets service-account key in client code.

Cloudflare continues to host the site and private roster ownership in D1. `/dashboard` is the participant dashboard. Firebase handles token refresh and Google sign-in. The Worker validates every account API token through Google's authenticated account lookup, checks its expected project and uid, and rejects disabled or revoked sessions. Email verification is required to submit.

Apply `migrations/0002_account_rosters.sql` to the existing D1 database before deploying this version. This migration was applied manually through the Cloudflare console on 2026-10-20. It is idempotent. Do not replay `0001_write_locks.sql` on this existing database.

Roster ownership is bound to the authenticated Firebase uid and season. Client-supplied names, email, Discord, uid, and submission tokens cannot select an owner. A server-generated submission token and the existing write lock coordinate the Sheets row and D1 ownership snapshot. The ownership checkpoint is persisted before attempting a Sheets write and remains until both stores confirm success. Users can recover only their own pending entry after two minutes. Organizer recovery also records account ownership. The saved roster keeps the names and prices from submission time.

Existing submissions made before accounts existed have no authenticated owner. Do not automatically assign them based on a matching name, email, or Discord string. Verify ownership with the organizer before a manual migration. The existing Google Sheets response columns are unchanged.

The dashboard offers only Google sign-in, which creates a league account automatically on first use and requests basic identity only. The authorized production domain is `sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev`. If a custom domain is added, add its exact hostname in Firebase Authentication → Settings → Authorized domains.

Submissions are enabled and the draft is open. The old Apps Script deployment is archived. Administration uses verified Firebase roles at `/admin`; no organizer password is needed. Scoring is not configured; dashboard copy explicitly says no points or standings are assigned. The previous hostname has been removed from Firebase authorized domains.

Validation: 20 local checks cover project/token rejection, email verification, account isolation, duplicate submission prevention, uncertain-write recovery, immutable roster snapshots, and cross-origin rejection. Live account sign-in and dashboard verification are recorded separately in the project handoff state.
