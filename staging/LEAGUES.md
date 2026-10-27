# Private leagues and invitations

Open **Leagues & access** from the FTC navigation or **Switch league / manage access** in the staging banner. The owner can select San Diego FTC or San Diego FRC, create another regional/group league, and manage its members. Other accounts have one assigned league and cannot switch, including through API calls or altered cookies.

San Diego FTC retains its existing prediction leaderboard, 15-Pollen budget, three-team limit, paid rosters, and isolated test workbook. **San Diego FRC drafting is disabled** until its rules and team pool are decided. New regional leagues also start with drafting disabled. No FTC team data, PP model, Pollen costs, or saved roster is presented as FRC data.

## Invite people

1. Select the intended league as the owner, or open **Manage league** as its coordinator.
2. Create a player invitation, optionally restricted to a Google email. Choose an expiration of 1–30 days and up to 100 joins.
3. Copy the link or code when it is shown. A recipient opens `/join`, enters the code if needed, and continues with their verified Google account.

Administrators and region moderators can create and revoke player invitations for their own league. Only the owner can create staff invitations. Staff invitations require the recipient's Google email and allow one join. To promote someone who already belongs to the league, change their role under **League members** instead of sending another invitation.

Invitations contain 128 random bits; only their SHA-256 hash is stored. Links carry the code in the URL fragment, which the browser removes after loading it into the join form. GET requests never redeem invitations. Redemption requires a same-origin POST and live Google verification; forwarded staff links cannot authorize a different Google email. Admission, capacity use, the FTC admin grant when applicable, and audit entries commit together in a D1 transaction. Retries do not consume another invitation.

An account already assigned to a league cannot use an invitation to switch leagues or restore revoked access. This release does not provide account transfers; the owner can view every league without joining it. Revoking an invitation stops future joins but does not remove existing members.

## Roles

| Role                 | Access                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                | Switch between all leagues; create leagues; assign/revoke staff and membership; create any invitation; all coordinator tools. The verified owner UID is protected.                          |
| League administrator | View their league's members and contacts; create/revoke player invitations; use existing FTC roster administration when assigned to San Diego FTC. No role assignments or league switching. |
| Region moderator     | View their league's member names and roles; create/revoke player invitations. No contact directory, staff invitations, FTC roster administration, role changes, or switching.               |
| Player               | View their assigned league and use its available drafting features. No member directory, invite management, or staff tools.                                                                 |

The owner changes roles and restores/revokes membership in **League members**. Access is checked on every request. Revoking access preserves saved FTC rosters; it does not delete entries or rewrite paid prices. Access changes are audited within their league. Membership emails come from verified Google sign-ins, not user-supplied role requests.

## Storage and deployment

`STAGING_LEAGUES_ENABLED="true"` enables the staging-only league boundary. `fantasy_leagues`, `fantasy_memberships`, `fantasy_invites`, and `fantasy_audit` are defined by [the additive migration](migrations/0001_leagues.sql). A unique membership UID enforces the current one-league-per-non-owner rule. The migration preserves the two previously approved staging admins as FTC admins without admitting unrelated existing accounts.

The staging workflow runs the idempotent migration against **ftc-draft-staging** before deploying the staging Worker. It needs the existing Cloudflare token's D1 Edit permission. SQL failure stops deployment. Reapplying the migration preserves role changes and revoked memberships. It never alters FTC receipt tables, the Sheet catalog, or production storage. The existing application migrations still require separate deliberate application when provisioning a fresh database.

The legacy FTC engine can only be called from the San Diego FTC context. New-league/FRC APIs either serve league-specific account/setup data or reject the request; they cannot fall through to FTC roster, admin, recovery, or prediction handlers. FTC administrator grants update the legacy admin table atomically with membership; FRC administrators never enter it. Existing FTC admin buttons route through the same membership checks.

`STAGING_MODE="owner-only"` is the emergency restriction: it rejects all non-owner access and invitation redemption, preserving the database. The previous admin-only implementation remains available with `STAGING_LEAGUES_ENABLED="false"`, but that disables league isolation and invited-player access; keep the flag enabled for normal multi-league testing.

Tests use local SQLite and injected verified identities. They cover role boundaries, direct route attempts, invite expiration/revocation/capacity, concurrent admission, Google email matching, atomic rollback, and preservation of FTC data. Local tests do not claim to exercise real recipients' Google browser sessions.
