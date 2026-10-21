# League administration

The admin dashboard is at `/admin`. Sign in through `/dashboard`; approved users also see an Admin navigation link.

## Roles

- The owner is the verified Firebase account with UID `UuhcrWq7CHS4F7ay01I7JKbohEz2` (the organizer's existing Google account). The server pins this UID; matching an email, changing browser state, or sending a role in a request does not grant access.
- Only the owner can add or remove admins. The owner's role cannot be removed through the dashboard.
- Admins can view participant details, reset or restore rosters, link legacy entries to verified accounts, open/close the draft, and recover interrupted saves. They cannot appoint admins.
- Ordinary players cannot read admin APIs or act on another player's roster. Every request verifies the Firebase token and current role on the server. Removing an admin takes effect on their next request.

## Adding an admin

Ask the person to sign in to the league website and verify their email. Open **Admin access**, refresh, find their account, choose **Add Admin**, and confirm with a reason. The directory records signed-in site visits; it is not a full Firebase account export. **Remove Admin** leaves their player account and roster intact.

## Entries and support

**Players & picks** shows active response-sheet entries, including older entries without account links. Search by name, Discord contact, account email, or team. Resetting clears exactly that response's A:T cells without shifting other rows and removes its account mapping. The original row and mapping are archived in D1. A player may then submit again.

Archived entries can be restored if no replacement entry conflicts and the selected teams remain eligible. Restores keep the original picks, prices, and receipt. For older entries, verify the person's identity directly before using **Link account**; a matching name alone is not proof.

**Activity & troubleshooting** shows Sheet connectivity, submission switches, pending writes, mismatched entries, and the latest 100 audit events. Audit history remains stored in D1. Every mutation requires a reason. This dashboard does not expose credentials or reset Firebase passwords. Sign-in is Google, Apple, or GitHub. Players recover access through that provider's own account recovery; existing league account and roster records are retained. A player who signs in with a different provider than they drafted with arrives as a separate account with no roster, so confirm which option they used before resetting or linking anything.

## Persistence and recovery

Apply `migrations/0003_admin_dashboard.sql` once before deploying this Worker. It adds `league_members`, `league_admins`, `admin_audit`, and `roster_archives`, without changing existing response rows or account rosters. The script is idempotent. Existing migrations were applied manually; do not replay the initial unguarded table creation.

Submissions, resets, restores, links, and draft settings use the same D1 write lock. Each admin operation saves a checkpoint before touching Sheets. A failed or uncertain write keeps the checkpoint. Recovery claims an exclusive two-minute lease, verifies the exact response row, and finishes the original operation. Archive/mapping changes, the operation audit, and lock release are one D1 transaction. Do not manually edit or reorder response rows while a checkpoint is pending.

The previous Basic-auth organizer interface redirects to `/admin`; its API is disabled so it cannot bypass the role checks or audit log. The Cloudflare `SUBMISSIONS_ENABLED` flag remains an independent deployment-level switch. Admin draft controls change `Settings!B2` in the private response workbook.

This release does not configure scoring or email notifications. The underlying website and account data remain on Cloudflare; Google Sheets remains the active roster record and Firebase handles sign-in.
