(() => {
  'use strict';
  const el = (id) => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const roleNames = {
    owner: 'Owner',
    admin: 'League administrator',
    moderator: 'Region moderator',
    player: 'Player',
  };
  let data,
    busy = false;
  const say = (message) => {
    el('leagueMessage').textContent = message;
  };
  async function api(body) {
    const response = await fetch('/api/leagues', {
      cache: 'no-store',
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load your league.');
    return result;
  }
  function empty(target, message) {
    target.replaceChildren(node('p', message, 'muted'));
  }
  function action(text, callback) {
    const button = node('button', text);
    button.type = 'button';
    button.onclick = callback;
    return button;
  }
  async function perform(body, after) {
    if (busy) return;
    busy = true;
    say('Saving…');
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await api({ ...body, contextLeagueId: data.league.id });
      await load();
      say(result.message || 'Saved.');
      if (after) after(result);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
      document.querySelectorAll('button').forEach((button) => {
        button.disabled = false;
      });
    }
  }
  function render() {
    document.title = data.league.name + ' · Fantasy League';
    el('leagueName').textContent = data.league.name;
    el('leagueDetails').textContent =
      `${data.league.region} · ${data.league.program} · ${roleNames[data.viewer.role]}`;
    el('leagueOverview').hidden = false;
    const enabled = data.drafting === 'existing-ftc';
    el('draftHeading').textContent = enabled ? 'Your FTC league' : 'Drafting is not open yet';
    el('draftDescription').textContent = enabled
      ? 'Draft up to three teams with 15 Pollen. View your saved entry in My dashboard.'
      : 'Members can join now. Drafting opens after the league rules and team pool are set.';
    el('draftLink').hidden = !enabled;
    el('ownerLeagues').hidden = !data.viewer.canSwitch;
    el('createLeagueDetails').hidden = !data.viewer.owner;
    el('leagueSelect').replaceChildren(
      ...data.leagues.map((league) => {
        const option = node('option', league.name);
        option.value = league.id;
        option.selected = league.id === data.league.id;
        return option;
      }),
    );
    el('invitePanel').hidden = !data.canCoordinate;
    el('memberPanel').hidden = !data.canCoordinate;
    el('inviteRoleLabel').hidden = !data.viewer.owner;
    if (!data.viewer.owner) el('inviteRole').value = 'player';
    el('inviteDescription').textContent = data.viewer.owner
      ? 'Invite players, region moderators, or administrators to this league. Region moderator links can be created without an email. Staff invitations can be used once.'
      : 'Create player invitations for this league. Only the owner can appoint staff or change roles.';
    inviteRequirements();
    el('roleDescription').textContent = data.viewer.owner
      ? 'Administrators can manage every region and program. Region moderators invite players and see members in their own league. Only you can assign roles or revoke access.'
      : data.viewer.canSwitch
        ? 'You can manage every region and program. Only the owner can appoint staff or change roles.'
        : 'Your access applies only to this league. Contact the owner for role or membership changes.';
    const members = el('memberList');
    members.replaceChildren();
    if (!data.members.length)
      empty(members, 'No invited members yet. The owner can access every league.');
    for (const member of data.members) {
      const row = node('article', undefined, 'league-row');
      row.append(
        node('strong', member.display_name || 'League member'),
        node('span', roleNames[member.role] + (member.active ? '' : ' · Access revoked'), 'badge'),
      );
      if (member.email) row.append(node('p', member.email, 'meta'));
      if (data.viewer.owner) {
        const form = node('form', undefined, 'form-row'),
          label = node('label', 'Member role'),
          select = node('select');
        for (const role of ['player', 'moderator', 'admin']) {
          const option = node('option', roleNames[role]);
          option.value = role;
          option.selected = role === member.role;
          select.append(option);
        }
        label.append(select);
        const save = node('button', 'Save role');
        save.type = 'submit';
        form.append(
          label,
          save,
          action(member.active ? 'Revoke access' : 'Restore access', () => {
            if (
              confirm(
                `${member.active ? 'Revoke' : 'Restore'} access for ${member.display_name || member.email || 'this member'}? Saved FTC rosters will remain.`,
              )
            )
              perform({
                action: 'setMember',
                uid: member.uid,
                role: member.role,
                active: !member.active,
              });
          }),
        );
        form.onsubmit = (event) => {
          event.preventDefault();
          perform({
            action: 'setMember',
            uid: member.uid,
            role: select.value,
            active: Boolean(member.active),
          });
        };
        row.append(form);
      }
      members.append(row);
    }
    const invites = el('inviteList');
    invites.replaceChildren();
    if (!data.invites.length) empty(invites, 'No invitations yet.');
    for (const invite of data.invites) {
      const row = node('article', undefined, 'league-row');
      const status = invite.revoked
        ? 'Revoked'
        : invite.expires_at <= Date.now()
          ? 'Expired'
          : invite.uses >= invite.max_uses
            ? 'Full'
            : 'Active';
      row.append(
        node('strong', roleNames[invite.role] + ' invitation'),
        node('span', status, 'badge'),
        node(
          'p',
          `${invite.uses}/${invite.max_uses} joined · Expires ${new Date(invite.expires_at).toLocaleString()}`,
          'meta',
        ),
      );
      if (invite.target_email) row.append(node('p', invite.target_email, 'meta'));
      if (status === 'Active')
        row.append(
          action('Revoke invitation', () => perform({ action: 'revokeInvite', id: invite.id })),
        );
      invites.append(row);
    }
    el('auditPanel').hidden = !data.viewer.owner && data.viewer.role !== 'admin';
    const audit = el('leagueAudit');
    audit.replaceChildren();
    if (!data.audit.length) empty(audit, 'No access changes recorded yet.');
    const actionNames = {
      join: 'Member joined',
      createInvite: 'Invitation created',
      revokeInvite: 'Invitation revoked',
      setMember: 'Member access changed',
      createLeague: 'League created',
    };
    for (const entry of data.audit)
      audit.append(
        node(
          'p',
          `${actionNames[entry.action] || 'Access changed'} · ${new Date(entry.created_at).toLocaleString()}`,
          'meta',
        ),
      );
  }
  async function load() {
    try {
      data = await api();
      render();
    } catch (error) {
      for (const id of [
        'leagueOverview',
        'ownerLeagues',
        'invitePanel',
        'memberPanel',
        'auditPanel',
        'newInvite',
      ])
        el(id).hidden = true;
      el('leagueName').textContent = 'League unavailable';
      el('leagueDetails').textContent = '';
      say(error.message);
      throw error;
    }
  }
  el('leagueRefresh').onclick = () => {
    el('newInvite').hidden = true;
    say('');
    load().catch(() => {});
  };
  el('switchLeagueForm').onsubmit = (event) => {
    event.preventDefault();
    perform({ action: 'switch', leagueId: el('leagueSelect').value }, () => location.assign('/'));
  };
  el('createLeagueForm').onsubmit = (event) => {
    event.preventDefault();
    perform(
      {
        action: 'createLeague',
        name: el('newLeagueName').value,
        region: el('newLeagueRegion').value,
        program: el('newLeagueProgram').value,
      },
      () => el('createLeagueForm').reset(),
    );
  };
  function inviteRequirements() {
    const role = el('inviteRole').value;
    const emailBound = Boolean(el('inviteEmail').value.trim());
    const single = role !== 'player' || emailBound;
    el('inviteEmail').required = role === 'admin';
    el('inviteEmailHint').textContent = role === 'admin' ? '(required)' : '(optional)';
    el('inviteAccessHint').textContent =
      role === 'admin'
        ? 'The specified Google account will become an administrator with access to every region and program.'
        : emailBound
          ? 'Only the specified Google account can use this invitation.'
          : role === 'moderator'
            ? 'The first new member to sign in with Google using this link becomes a region moderator for this league. Create a separate link for each person.'
            : 'Anyone with this link can join this league as a player using Google.';
    el('inviteUses').disabled = single;
    if (single) el('inviteUses').value = '1';
  }
  el('inviteRole').onchange = inviteRequirements;
  el('inviteEmail').oninput = inviteRequirements;
  el('createInviteForm').onsubmit = (event) => {
    event.preventDefault();
    el('newInvite').hidden = true;
    perform(
      {
        action: 'createInvite',
        role: el('inviteRole').value,
        email: el('inviteEmail').value.trim(),
        days: Number(el('inviteDays').value),
        maxUses: Number(el('inviteUses').value),
      },
      (result) => {
        el('inviteCode').value = result.code;
        el('inviteLink').value = location.origin + '/join#invite=' + result.code;
        el('newInvite').hidden = false;
      },
    );
  };
  el('copyInvite').onclick = async () => {
    try {
      await navigator.clipboard.writeText(el('inviteLink').value);
      say('Invitation link copied.');
    } catch {
      el('inviteLink').select();
      say('Select and copy the invitation link.');
    }
  };
  if (document.body.dataset.leaguePage === 'workspace')
    document.addEventListener('league-session-ready', () => load().catch(() => {}));
  else load().catch(() => {});
})();
