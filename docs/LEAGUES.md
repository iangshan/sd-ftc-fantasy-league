# Leagues and invitations

Open **Leagues & access** from the navigation. The owner and league administrators can switch into every region and program, including San Diego FTC and San Diego FRC. Only the owner can create regional/group leagues and appoint staff. Moderators and players remain in their assigned league, including through direct API calls or altered cookies.

San Diego FTC retains its draft board, 15-Pollen budget, three-team limit, paid rosters, and existing workbook. **San Diego FRC drafting is disabled** until its rules and team pool are decided. New regional leagues also start with drafting disabled. No FTC team data, PP model, Pollen costs, or saved roster is presented as FRC data.

## Invite people

1. Select the intended league as the owner, or open **Manage league** as its coordinator.
2. Create a player invitation, optionally restricted to a Google email. Choose an expiration of 1–30 days and up to 100 joins.
3. Copy the link or code when it is shown. A recipient opens `/join`, enters the code if needed, and continues with their verified Google account.

Administrators and region moderators can create and revoke player invitations for the league they are viewing. Moderators are restricted to their assigned league. Only the owner can create staff invitations, which always allow one join.

To invite a new region moderator without collecting their email, select **Region moderator**, leave **Google account email** blank, and click **Create invitation → Copy link**. The first new member to redeem the link with a verified Google account becomes a moderator for the selected league. Create a separate link for each person. Optionally enter an email to restrict the link to that account. Administrator invitations still require the recipient's Google email.

To promote someone who already belongs to the league, change their role under **League members** instead of sending another invitation.

Invitations contain 128 random bits; only their SHA-256 hash is stored. Links carry the code in the URL fragment, which the browser removes after loading it into the join form. GET requests never redeem invitations. Redemption requires a same-origin POST and live Google verification; invitations restricted to an email cannot authorize a different Google email. Admission, capacity use, the global administrator grant when applicable, and audit entries commit together in a D1 transaction. Retries do not consume another invitation.

An account already assigned to a league cannot use an invitation to switch leagues or restore revoked access. This release does not provide account transfers; the owner and administrators can view every league without joining it. Revoking an invitation stops future joins but does not remove existing members.

## Roles

| Role                 | Access                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                | Switch between all leagues; create leagues; assign/revoke staff and membership; create any invitation; all coordinator tools. The verified owner UID is protected.                                       |
| League administrator | Switch into every region and program; view the selected league’s members and contacts; create/revoke player invitations; use San Diego FTC roster administration. Cannot assign staff or create leagues. |
| Region moderator     | View their league's member names and roles; create/revoke player invitations. No contact directory, staff invitations, FTC roster administration, role changes, or switching.                            |
| Player               | View their assigned league and use its available drafting features. No member directory, invite management, or staff tools.                                                                              |

The owner changes roles and restores/revokes membership in **League members**. Access is checked on every request. Revoking access preserves saved FTC rosters; it does not delete entries or rewrite paid prices. Access changes are audited within their league. Membership emails come from verified Google sign-ins, not user-supplied role requests.

## Storage and deployment

Both deployments use `src/leagues.mjs`, `src/league-navigation.mjs`, and `web/leagues.*`. The public boundary is `src/public-worker.mjs`, enabled by `LEAGUES_ENABLED="true"`; the private boundary remains `staging/worker.mjs`. They share code and Google identity verification, but use separate D1 databases, Sheets, sessions, memberships, and invitations. A staging invitation does not grant public access, or vice versa.

The public release workflow executes only [0005_regional_leagues.sql](../migrations/0005_regional_leagues.sql) against **ftc-draft-coordination** before deploying. It creates the regional tables and seeds San Diego FTC/FRC. Existing public member records, roster owners, and administrators receive FTC memberships; previously approved administrators keep their privileges. It does not import staging accounts or invitations. `INSERT OR IGNORE` preserves subsequent role changes and revocations on replay. Saved rosters, receipts, archives, and Sheets are untouched.

The staging workflow applies [its separate migration](../staging/migrations/0001_leagues.sql) against **ftc-draft-staging**. It preserves approved staging admins without admitting unrelated accounts. Both migrations require D1 Edit permission, and a SQL failure stops deployment. Neither workflow replays the original production migrations.

Each UID has one home league. Administrators can view other leagues without changing that membership. Admin grants and revocations update the legacy FTC admin table atomically with membership, regardless of the home league. Moderator grants never add a legacy admin role. Access checks read current membership on every request.

The legacy FTC engine can only be called from the San Diego FTC context. New-league/FRC APIs serve league-specific setup data or reject the request; they cannot fall through to FTC roster, admin, or recovery handlers. FRC and new regional drafting remain disabled until a separate release configures rules and team pools.

Public visitors can browse the FTC board and open `/join`. New accounts need an invitation to join a league; existing public accounts retain access. Google sign-in establishes a short-lived, host-only, Secure, HttpOnly session cookie. Firebase refreshes it while signed in. All membership mutations require a same-origin POST, and bearer tokens are verified before membership or roster access. Sign-out clears the cookie. Private staging retains its own login guard and emergency `STAGING_MODE="owner-only"` switch.

Tests use local SQLite and injected verified identities. They cover role boundaries, direct route attempts, invite expiration/revocation/capacity, concurrent admission, Google email matching, atomic rollback, public migration replay, and preservation of FTC data. Local tests do not claim to exercise real recipients’ Google browser sessions.
