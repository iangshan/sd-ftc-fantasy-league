# League administration

The admin dashboard is at `/admin`. Sign in through `/dashboard`; the server determines the available actions from the verified account's role.

## Roles and access

The owner UID is pinned in `worker.mjs`. Only the owner can grant or revoke admin roles, and the owner's role cannot be removed through the dashboard. Matching an email address or sending a client-side role does not grant access.

Admins may inspect participant entries, reset or restore rosters, link verified accounts to legacy entries, open or close the draft, and recover interrupted saves. They cannot appoint other admins. Each protected request rechecks the current role, so removing an admin takes effect on the next request.

Roles are separate in production and staging. Private staging requires verified Google sign-in and an active league membership, with the pinned owner able to access every league. Use **Leagues & access** to invite administrators or region moderators and update existing members; [the staging role guide](../staging/LEAGUES.md) defines their limits. A later production role change is not automatically mirrored into staging. The `owner-only` restriction temporarily locks staging to the owner without deleting records.

Repository contributors do not automatically become league admins. People who can deploy code remain trusted because deployed code runs with the environment's bindings and secrets.

## Grant or remove an admin

For the public league, have the person sign in and verify their email. The owner can then open **Admin access**, refresh the account directory, choose the account, and select **Add Admin** with a reason. The directory contains accounts that have visited the site, not a complete Firebase export.

**Remove Admin** leaves the person's player account and roster intact. In staging, demoting an administrator also retains their league membership. To remove staging access entirely, use **Leagues & access → League members → Revoke access**. Removing only a production role does not revoke staging membership.

## Rosters and support

**Players & picks** shows active response-sheet entries, including legacy entries without an account link. Search by player name, Discord contact, account email, or team.

Resetting an entry clears only that response's A:T cells and removes its account mapping. The original row and mapping are archived in D1, and the player may submit again. Restoring an archive requires that no replacement entry conflict and all selected teams remain eligible; the original picks, prices, and receipt are retained.

For **Link account**, verify the person's identity directly. For sign-in problems, ask which Google, Apple, or GitHub identity they originally used before resetting or linking anything. Provider account recovery is separate from league administration; the dashboard does not expose credentials or reset Firebase passwords.

## Recovery and audit

**Activity & troubleshooting** shows Sheet connectivity, submission switches, pending operations, mismatched entries, and recent audit activity. Each admin mutation requires a reason, and audit records remain stored in D1.

Submissions and admin mutations share a D1 write lock. An operation saves a checkpoint before changing Sheets. If its outcome is uncertain, recovery waits for the lease, checks the exact response row, and finishes the original operation. Archive or ownership changes, the audit record, and lock release are committed together. Do not manually edit or reorder response rows during a pending operation.

The former Basic-auth organizer interface redirects to `/admin`; its API is disabled. `SUBMISSIONS_ENABLED` remains a deployment-level switch independent of the draft's `Settings!B2` value.

## Database operations

The existing production database was initialized manually. `0003_admin_dashboard.sql` defines the member, admin, audit, and archive tables. The historical `0002_account_rosters.sql` is empty; `0004_account_rosters_schema.sql` supplies account-roster storage for new installations without replacing an existing table. Do not replay the original unguarded migrations against an existing database, and review its migration history before applying a later one. The staging workflow applies only its additive league schema; production migrations remain manual.

Use clearly labeled local or staging test entries for operational checks. Never reset another player's roster merely to test a change. The prediction experiment does not assign official earned standings or send email notifications.
