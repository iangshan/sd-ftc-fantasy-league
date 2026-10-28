export const FTC_LEAGUE = 'san-diego-ftc';
export const LEAGUE_COOKIE = '__Host-fantasy-league';
const roles = ['player', 'moderator', 'admin'];

export class LeagueError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function verifiedGoogle(user) {
  if (!user?.uid || user.emailVerified !== true || user.signInProvider !== 'google.com')
    throw new LeagueError('A verified Google account is required.', 403);
}
function required(value, label, max = 100) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new LeagueError(`Enter a valid ${label}.`);
  return value.trim();
}
function emailAddress(value) {
  const email = required(value, 'Google account email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new LeagueError('Enter a valid Google account email.');
  return email;
}
async function rows(db, query, ...args) {
  const result = await db
    .prepare(query)
    .bind(...args)
    .all();
  if (result.success === false || !Array.isArray(result.results))
    throw new Error('League database unavailable.');
  return result.results;
}
const now = () => new Date().toISOString();
export function leagueCookie(id) {
  return `${LEAGUE_COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`;
}
export function selectedLeague(request, fallback = FTC_LEAGUE) {
  return (
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(LEAGUE_COOKIE + '='))
      ?.slice(LEAGUE_COOKIE.length + 1) || fallback
  );
}
export async function leagueContext(db, user, ownerUid, request) {
  verifiedGoogle(user);
  const owner = user.uid === ownerUid;
  const member = owner
    ? null
    : await db.prepare('SELECT * FROM fantasy_memberships WHERE uid = ?').bind(user.uid).first();
  if (!owner && (!member || member.active !== 1))
    throw new LeagueError('Ask your coordinator for a league invitation.', 403);
  const canSwitch = owner || member.role === 'admin';
  // Moderators and players never select a league via client-controlled fields.
  const id = canSwitch
    ? selectedLeague(request, member?.league_id || FTC_LEAGUE)
    : member.league_id;
  const league = await db.prepare('SELECT * FROM fantasy_leagues WHERE id = ?').bind(id).first();
  if (!league) throw new LeagueError('This league is unavailable. Ask the owner for help.', 404);
  return { user, owner, canSwitch, role: owner ? 'owner' : member.role, league };
}
function coordinator(context) {
  if (!['owner', 'admin', 'moderator'].includes(context.role))
    throw new LeagueError('Coordinator access is required.', 403);
}
function ownerOnly(context) {
  if (!context.owner)
    throw new LeagueError('Only the owner can create leagues or manage roles.', 403);
}
function audit(db, context, action, target, details = {}) {
  return db
    .prepare(
      'INSERT INTO fantasy_audit (id,league_id,actor_uid,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      context.league.id,
      context.user.uid,
      action,
      target,
      JSON.stringify(details),
      now(),
    );
}
async function tokenHash(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function leagueSnapshot(db, context) {
  const canCoordinate = ['owner', 'admin', 'moderator'].includes(context.role);
  const canViewContacts = context.owner || context.role === 'admin';
  const leagues = context.canSwitch
    ? await rows(db, 'SELECT * FROM fantasy_leagues ORDER BY name')
    : [context.league];
  const members = canCoordinate
    ? await rows(
        db,
        'SELECT uid,role,active,display_name,email,joined_at FROM fantasy_memberships WHERE league_id = ? ORDER BY joined_at',
        context.league.id,
      )
    : [];
  const invites = canCoordinate
    ? await rows(
        db,
        'SELECT id,role,target_email,expires_at,max_uses,uses,revoked,created_at FROM fantasy_invites WHERE league_id = ? ORDER BY created_at DESC LIMIT 100',
        context.league.id,
      )
    : [];
  const events = canViewContacts
    ? await rows(
        db,
        'SELECT action,target_id,details_json,created_at FROM fantasy_audit WHERE league_id = ? ORDER BY created_at DESC LIMIT 50',
        context.league.id,
      )
    : [];
  return {
    viewer: {
      uid: context.user.uid,
      role: context.role,
      owner: context.owner,
      canSwitch: context.canSwitch,
    },
    league: context.league,
    leagues,
    canCoordinate,
    drafting: context.league.engine === 'legacy-ftc' ? 'existing-ftc' : 'disabled',
    members: members.map(({ email, ...member }) =>
      canViewContacts ? { ...member, email } : member,
    ),
    invites: invites
      .filter((invite) => canViewContacts || invite.role === 'player')
      .map(({ target_email, ...invite }) =>
        canViewContacts ? { ...invite, target_email } : invite,
      ),
    audit: events,
  };
}

export async function leagueMutation(db, context, input, ownerUid) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new LeagueError('Invalid league request.');
  if (input.action === 'switch') {
    if (!context.canSwitch)
      throw new LeagueError('Only league administrators can switch regions or programs.', 403);
    const id = required(input.leagueId, 'league');
    const league = await db.prepare('SELECT id FROM fantasy_leagues WHERE id = ?').bind(id).first();
    if (!league) throw new LeagueError('League not found.', 404);
    return { ok: true, selectedLeague: id };
  }
  if (input.contextLeagueId !== context.league.id)
    throw new LeagueError('Your active league changed. Refresh before making changes.', 409);
  if (input.action === 'createLeague') {
    ownerOnly(context);
    const name = required(input.name, 'league name'),
      region = required(input.region, 'region or group');
    if (!['FTC', 'FRC'].includes(input.program)) throw new LeagueError('Choose FTC or FRC.');
    const id = 'league-' + crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          'INSERT INTO fantasy_leagues (id,name,region,program,engine,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(id, name, region, input.program, 'setup', now()),
      audit(db, context, 'createLeague', id, { name, region, program: input.program }),
    ]);
    return {
      ok: true,
      message:
        'League created. Drafting stays disabled until its rules and team pool are configured.',
    };
  }
  if (input.action === 'createInvite') {
    coordinator(context);
    const role = input.role ?? 'player';
    if (!roles.includes(role)) throw new LeagueError('Choose a valid role.');
    if (role !== 'player') ownerOnly(context);
    const targetEmail = input.email ? emailAddress(input.email) : null;
    if (role === 'admin' && !targetEmail)
      throw new LeagueError('Administrator invitations must name the recipient’s Google email.');
    const days = input.days ?? 7,
      maxUses = role !== 'player' || targetEmail ? 1 : (input.maxUses ?? 25);
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 30 ||
      !Number.isInteger(maxUses) ||
      maxUses < 1 ||
      maxUses > 100
    )
      throw new LeagueError('Use 1–30 days and 1–100 invitations.');
    const code = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const id = crypto.randomUUID(),
      expiresAt = Date.now() + days * 86400000;
    await db.batch([
      db
        .prepare(
          'INSERT INTO fantasy_invites (id,league_id,token_hash,role,target_email,expires_at,max_uses,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          context.league.id,
          await tokenHash(code),
          role,
          targetEmail,
          expiresAt,
          maxUses,
          context.user.uid,
          now(),
        ),
      audit(db, context, 'createInvite', id, { role, maxUses, expiresAt }),
    ]);
    return {
      ok: true,
      code,
      expiresAt,
      role,
      message: 'Copy this invitation now. Its code is shown only once.',
    };
  }
  if (input.action === 'revokeInvite') {
    coordinator(context);
    const id = required(input.id, 'invitation');
    const invite = await db
      .prepare('SELECT role FROM fantasy_invites WHERE id = ? AND league_id = ?')
      .bind(id, context.league.id)
      .first();
    if (!invite) throw new LeagueError('Invitation not found in this league.', 404);
    if (invite.role !== 'player') ownerOnly(context);
    await db.batch([
      db
        .prepare('UPDATE fantasy_invites SET revoked = 1 WHERE id = ? AND league_id = ?')
        .bind(id, context.league.id),
      audit(db, context, 'revokeInvite', id),
    ]);
    return { ok: true, message: 'Invitation revoked. Existing members keep their access.' };
  }
  if (input.action === 'setMember') {
    ownerOnly(context);
    const uid = required(input.uid, 'member account', 128);
    if (uid === ownerUid) throw new LeagueError('The owner account is protected.', 403);
    if (!roles.includes(input.role) || typeof input.active !== 'boolean')
      throw new LeagueError('Choose a role and access status.');
    const member = await db
      .prepare('SELECT uid FROM fantasy_memberships WHERE uid = ? AND league_id = ?')
      .bind(uid, context.league.id)
      .first();
    if (!member)
      throw new LeagueError('Member not found in this league. Send an invitation first.', 404);
    const statements = [
      db
        .prepare(
          'UPDATE fantasy_memberships SET role = ?, active = ? WHERE uid = ? AND league_id = ?',
        )
        .bind(input.role, input.active ? 1 : 0, uid, context.league.id),
    ];
    // Administrators have access to every region, including the legacy FTC tools.
    // Moderators never receive this grant. Keep both role stores in one transaction.
    statements.push(
      input.active && input.role === 'admin'
        ? db
            .prepare(
              'INSERT INTO league_admins (uid,granted_by,granted_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at',
            )
            .bind(uid, context.user.uid, now())
        : db.prepare('DELETE FROM league_admins WHERE uid = ?').bind(uid),
    );
    statements.push(
      audit(db, context, 'setMember', uid, { role: input.role, active: input.active }),
    );
    await db.batch(statements);
    return { ok: true, message: 'Member access updated. Changes apply on their next request.' };
  }
  throw new LeagueError('Unknown league action.');
}

export async function acceptInvite(db, user, rawCode, ownerUid) {
  verifiedGoogle(user);
  if (user.uid === ownerUid)
    throw new LeagueError(
      'Your owner account already has access to every league. Use the league switcher.',
    );
  const code = typeof rawCode === 'string' ? rawCode.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{32}$/.test(code)) throw new LeagueError('Enter a valid invitation code.');
  const invite = await db
    .prepare('SELECT * FROM fantasy_invites WHERE token_hash = ?')
    .bind(await tokenHash(code))
    .first();
  if (!invite) throw new LeagueError('This invitation is unavailable.', 404);
  if (invite.target_email && invite.target_email !== emailAddress(user.email))
    throw new LeagueError('Sign in with the Google account named on this invitation.', 403);
  const existing = await db
    .prepare('SELECT league_id,active FROM fantasy_memberships WHERE uid = ?')
    .bind(user.uid)
    .first();
  if (existing) {
    if (existing.active === 1 && existing.league_id === invite.league_id) {
      const membership = await db
        .prepare('SELECT role FROM fantasy_memberships WHERE uid = ?')
        .bind(user.uid)
        .first();
      if (invite.role !== 'player' && membership.role !== invite.role)
        throw new LeagueError(
          'You already belong to this league. Ask the owner to update your role in League members.',
          409,
        );
      return;
    }
    throw new LeagueError(
      'Your account is already assigned to a league or its access was revoked. Contact the owner.',
      409,
    );
  }
  const nonce = crypto.randomUUID(),
    joinedAt = now();
  // D1 batch is one transaction. Admission, capacity, staff grant, and audit are
  // conditional on this request's unique claim; retries cannot consume twice.
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO fantasy_memberships (uid,league_id,role,active,email,display_name,joined_at,joined_invite,join_nonce) SELECT ?,league_id,role,1,?,?,?,?,? FROM fantasy_invites WHERE id = ? AND revoked = 0 AND expires_at > ? AND uses < max_uses',
      )
      .bind(
        user.uid,
        emailAddress(user.email),
        String(user.displayName || '').slice(0, 100),
        joinedAt,
        invite.id,
        nonce,
        invite.id,
        Date.now(),
      ),
    db
      .prepare(
        'UPDATE fantasy_invites SET uses = uses + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM fantasy_memberships WHERE uid = ? AND join_nonce = ?)',
      )
      .bind(invite.id, user.uid, nonce),
    db
      .prepare(
        "INSERT OR IGNORE INTO league_admins (uid,granted_by,granted_at) SELECT uid,?,? FROM fantasy_memberships WHERE uid = ? AND join_nonce = ? AND role = 'admin'",
      )
      .bind(invite.created_by, joinedAt, user.uid, nonce),
    db
      .prepare(
        'INSERT INTO fantasy_audit (id,league_id,actor_uid,action,target_id,details_json,created_at) SELECT ?,league_id,?, ?, ?, ?, ? FROM fantasy_memberships WHERE uid = ? AND join_nonce = ?',
      )
      .bind(
        crypto.randomUUID(),
        user.uid,
        'join',
        user.uid,
        JSON.stringify({ invitation: invite.id, role: invite.role }),
        joinedAt,
        user.uid,
        nonce,
      ),
  ]);
  const member = await db
    .prepare('SELECT league_id,active FROM fantasy_memberships WHERE uid = ?')
    .bind(user.uid)
    .first();
  if (!member || member.active !== 1 || member.league_id !== invite.league_id)
    throw new LeagueError(
      'This invitation is expired, revoked, full, or your account already belongs to another league.',
      409,
    );
}

export async function readLeagueInput(request) {
  const body = await request.text();
  if (body.length > 8192) throw new LeagueError('Request is too large.', 413);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new LeagueError('Invalid request.');
  }
}
