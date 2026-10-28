# Private staging leagues

The shared [league and invitation guide](../docs/LEAGUES.md) covers joining, moderator links, global administrators, and membership controls.

Staging uses the same workspace as the public site, with a separate database, workbook, invitations, and session cookie. Accounts must be invited separately to each environment. Existing approved staging administrators retain access and may switch into every region and program. Only the owner can create leagues and appoint staff.

`STAGING_LEAGUES_ENABLED="true"` keeps membership isolation enabled. `STAGING_MODE="owner-only"` temporarily restricts staging to the pinned owner and blocks invitation redemption without deleting data. See [the staging guide](README.md) for deployment and rollback instructions.
