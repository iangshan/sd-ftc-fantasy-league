// Staging roles live in the isolated staging database. Production data is never
// consulted from a browser request, and email addresses are not access keys.
export async function requireStagingAdmin(user, db, ownerUid) {
  if (
    !user ||
    typeof user.uid !== 'string' ||
    !user.uid ||
    user.emailVerified !== true ||
    user.signInProvider !== 'google.com'
  ) {
    throw { status: 403 };
  }

  if (user.uid === ownerUid) return;

  let membership;
  try {
    if (!db) throw new Error('Staging role database is unavailable.');
    membership = await db
      .prepare('SELECT uid FROM league_admins WHERE uid = ?')
      .bind(user.uid)
      .first();
  } catch {
    throw { status: 503 };
  }

  // Check the current role for every request, including existing session cookies.
  // A role removed from staging takes effect without waiting for token expiry.
  if (membership?.uid !== user.uid) throw { status: 403 };
}
