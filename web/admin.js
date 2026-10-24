(() => {
  'use strict';
  const el = (id) => document.getElementById(id),
    node = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
  const labels = {
    grantAdmin: 'Admin added',
    revokeAdmin: 'Admin removed',
    resetRoster: 'Roster reset',
    restoreRoster: 'Roster restored',
    linkRoster: 'Account linked',
    setOpen: 'Draft setting changed',
    recover: 'Save recovery',
  };
  let data = null,
    loading = false,
    mutating = false,
    action = null,
    revision = 0,
    loadedUid = null;
  const date = (value) => {
    const d = new Date(value);
    return Number.isNaN(d.valueOf()) ? String(value) : d.toLocaleString();
  };
  const message = (text) => {
    el('adminMessage').textContent = text;
    el('adminMessage').hidden = !text;
  };
  const button = (label, fn) => {
    const b = node('button', 'account-button', label);
    b.type = 'button';
    b.onclick = fn;
    b.disabled = mutating;
    return b;
  };
  function empty(target, text) {
    target.replaceChildren(node('p', 'admin-empty', text));
  }
  function hidePrivate() {
    revision++;
    loading = false;
    data = null;
    loadedUid = null;
    el('adminWorkspace').hidden = true;
    el('adminIdentity').replaceChildren();
    for (const id of [
      'adminEntries',
      'adminMembers',
      'adminAudit',
      'adminArchives',
      'adminDiagnostics',
      'adminIssues',
      'adminSummary',
      'adminControls',
    ])
      el(id).replaceChildren();
    if (el('adminConfirm').open) el('adminConfirm').close();
  }
  async function load() {
    const session = window.leagueAccount;
    if (!session?.user) return;
    const current = ++revision,
      uid = session.user.uid;
    loading = true;
    el('adminRefresh').disabled = true;
    try {
      const result = await session.api('/api/admin');
      if (current !== revision || window.leagueAccount?.user?.uid !== uid) return;
      data = result;
      loadedUid = uid;
      el('adminGate').hidden = true;
      el('adminWorkspace').hidden = false;
      render();
    } catch (error) {
      if (current !== revision) return;
      hidePrivate();
      el('adminGate').hidden = false;
      el('adminGate').replaceChildren(
        node('span', '', error.message + ' '),
        button('Try again', load),
      );
    } finally {
      if (current === revision) {
        loading = false;
        el('adminRefresh').disabled = false;
      }
    }
  }
  function accountChanged() {
    const session = window.leagueAccount;
    if (!session?.ready) return;
    if (session.error) {
      hidePrivate();
      el('adminGate').hidden = false;
      el('adminGate').replaceChildren(
        node('span', '', session.error + ' '),
        button('Reload page', () => location.reload()),
      );
      return;
    }
    if (!session.user) {
      hidePrivate();
      el('adminGate').hidden = false;
      el('adminGate').replaceChildren(
        node('span', '', 'Sign in with your approved league account to continue. '),
      );
      const a = node('a', '', 'Sign in');
      a.href = '/dashboard';
      el('adminGate').append(a);
      return;
    }
    if (!session.data) return;
    if (!['admin', 'owner'].includes(session.data.role)) {
      hidePrivate();
      el('adminGate').hidden = false;
      el('adminGate').textContent =
        'This account does not have admin access. Ask the league owner to add you, then refresh this page.';
      return;
    }
    if (loadedUid !== session.user.uid && !loading) load();
  }
  function render() {
    el('adminIdentity').replaceChildren(
      node('strong', '', data.viewer.role === 'owner' ? 'League owner' : 'League admin'),
      node('span', '', data.viewer.email),
    );
    el('adminSummary').replaceChildren();
    for (const [label, value] of [
      [
        'Draft',
        data.status.open === null
          ? 'Unavailable'
          : data.status.open && data.status.submissionsEnabled
            ? 'Open'
            : 'Closed',
      ],
      ['Saved rosters', data.status.connected ? data.entries.length : '—'],
      ['Known accounts', data.members.length],
      ['Available teams', data.status.availableTeams ?? '—'],
    ]) {
      const box = node('div', 'admin-stat');
      box.append(node('small', '', label), node('strong', '', String(value)));
      el('adminSummary').append(box);
    }
    el('adminAccessDescription').textContent =
      data.viewer.role === 'owner'
        ? 'You control admin access. Admins can view participant details, reset or restore rosters, link older entries, open or close the draft, and recover saves. Only you can add or remove admins.'
        : 'Admins can manage entries and troubleshoot saves. Only the league owner can add or remove admins.';
    renderEntries();
    renderMembers();
    renderArchives();
    renderDiagnostics();
    renderAudit();
  }
  function matching(object, query) {
    return JSON.stringify(object).toLowerCase().includes(query);
  }
  function entryInfo(entry) {
    const info = node('div', '');
    info.append(
      node('h3', '', entry.playerName || 'Unnamed player'),
      node('p', '', entry.playerTeamName + ' · Discord: ' + entry.discordId),
    );
    const picks = node('div', 'admin-picks');
    entry.teams.forEach((t) =>
      picks.append(
        node('span', 'admin-pick', '#' + t.number + ' ' + t.name + ' · ' + t.price + ' pollen'),
      ),
    );
    info.append(picks, node('p', '', entry.total + ' / 15 pollen · ' + date(entry.submittedAt)));
    const member = data.members.find((m) => m.uid === entry.uid);
    info.append(
      node(
        'p',
        '',
        entry.uid ? 'Account: ' + (member?.email || entry.uid) : 'Not linked to an account',
      ),
      node('p', 'admin-meta', 'Receipt ' + entry.receiptId),
    );
    return info;
  }
  function renderEntries() {
    const target = el('adminEntries'),
      query = el('adminRosterSearch').value.trim().toLowerCase();
    target.replaceChildren();
    if (!data.status.connected) {
      empty(
        target,
        'Rosters cannot be loaded until the Google Sheets connection is working. See Activity & troubleshooting.',
      );
      return;
    }
    for (const e of data.entries.filter((e) =>
      matching({ ...e, email: data.members.find((m) => m.uid === e.uid)?.email }, query),
    )) {
      const row = node('article', 'admin-row'),
        actions = node('div', 'account-actions');
      actions.append(
        button('Reset roster', () =>
          confirmAction(
            { action: 'resetRoster', receiptId: e.receiptId },
            'Reset ' + e.playerName + '’s roster?',
            'This removes the active entry from Google Sheets and their dashboard, then lets them draft again. The original is archived so it can be restored.',
          ),
        ),
      );
      if (!e.uid)
        actions.append(
          button('Link account', () =>
            confirmAction(
              { action: 'linkRoster', receiptId: e.receiptId },
              'Link ' + e.playerName + '’s roster',
              'The selected account will be able to view this roster. Confirm the player’s identity before continuing.',
            ),
          ),
        );
      row.append(entryInfo(e), actions);
      target.append(row);
    }
    if (!target.children.length)
      empty(
        target,
        query ? 'No rosters match your search.' : 'No rosters have been submitted yet.',
      );
  }
  function renderMembers() {
    const target = el('adminMembers'),
      query = el('adminMemberSearch').value.trim().toLowerCase();
    target.replaceChildren();
    for (const m of data.members.filter((m) => matching([m.email, m.display_name], query))) {
      const row = node('article', 'admin-row'),
        info = node('div', ''),
        actions = node('div', 'account-actions');
      info.append(
        node('span', 'admin-badge ' + m.role, m.role),
        node('h3', '', m.display_name || m.email),
        node('p', '', m.email),
        node(
          'p',
          '',
          (m.email_verified ? 'Verified email' : 'Email not verified') +
            ' · ' +
            (m.hasRoster ? 'Roster saved' : 'No account roster') +
            ' · Last seen ' +
            date(m.last_seen),
        ),
        node('p', 'admin-meta', 'Account ID ' + m.uid),
      );
      if (data.viewer.role === 'owner' && m.role !== 'owner') {
        const grant = m.role !== 'admin';
        const b = button(grant ? 'Add Admin' : 'Remove Admin', () =>
          confirmAction(
            { action: grant ? 'grantAdmin' : 'revokeAdmin', uid: m.uid },
            (grant ? 'Make admin: ' : 'Remove admin: ') + (m.display_name || m.email),
            grant
              ? 'This gives ' +
                  m.email +
                  ' access to everyone’s picks and contact details, roster resets and restores, draft controls, and save recovery. They cannot manage admins.'
              : 'This removes ' +
                  m.email +
                  '’s admin access on their next request. Their player account and roster remain.',
          ),
        );
        b.disabled = grant && !m.email_verified;
        actions.append(b);
      } else if (m.role === 'owner')
        actions.append(node('span', 'admin-badge owner', 'Owner protected'));
      row.append(info, actions);
      target.append(row);
    }
    if (!target.children.length) empty(target, 'No accounts match your search.');
  }
  function renderArchives() {
    el('adminArchiveTitle').textContent = 'Archived rosters (' + data.archives.length + ')';
    const target = el('adminArchives');
    target.replaceChildren();
    for (const a of data.archives) {
      const row = node('article', 'admin-row'),
        info = entryInfo(a.entry),
        actions = node('div', 'account-actions');
      info.append(node('p', '', 'Reset ' + date(a.archivedAt) + ' · ' + a.reason));
      actions.append(
        button('Restore roster', () =>
          confirmAction(
            { action: 'restoreRoster', archiveId: a.id },
            'Restore ' + a.entry.playerName + '’s roster?',
            'This returns the original picks to Google Sheets and its linked account. Restoration is blocked if the player has a replacement entry or a selected team is no longer eligible.',
          ),
        ),
      );
      row.append(info, actions);
      target.append(row);
    }
    if (!target.children.length) empty(target, 'No archived rosters.');
  }
  function renderDiagnostics() {
    const s = data.status,
      target = el('adminDiagnostics');
    target.replaceChildren();
    for (const [label, value] of [
      ['Google Sheets', s.connected ? 'Connected' : 'Needs attention'],
      ['Submission service', s.submissionsEnabled ? 'Enabled' : 'Disabled'],
      ['Draft setting', s.open === null ? 'Unknown' : s.open ? 'Open' : 'Closed'],
      ['Last checked', date(s.checkedAt)],
      ['Save queue', data.pending ? 'Operation in progress' : 'Clear'],
    ]) {
      const row = node('div', 'admin-diagnostic');
      row.append(node('span', '', label), node('strong', '', value));
      target.append(row);
    }
    if (s.sheetsError) target.append(node('p', '', s.sheetsError));
    const link = node('a', 'text-button', 'Open private response spreadsheet ↗');
    link.href = s.workbookUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    target.append(link);
    const controls = el('adminControls');
    controls.replaceChildren();
    const toggle = button(s.open ? 'Close draft' : 'Open draft', () =>
      confirmAction(
        { action: 'setOpen', open: !s.open },
        s.open ? 'Close draft submissions?' : 'Open draft submissions?',
        s.open
          ? 'Players can still view the board and their saved roster. New submissions will stop.'
          : 'Verified players will be able to submit their picks.',
      ),
    );
    toggle.disabled = !s.connected || Boolean(data.pending) || !s.submissionsEnabled;
    controls.append(toggle);
    const issues = el('adminIssues');
    issues.replaceChildren();
    if (data.pending) {
      const p = data.pending,
        box = node('div', 'admin-issue');
      box.append(
        node('h3', '', 'Pending ' + p.kind),
        node(
          'p',
          '',
          'Started ' + date(p.startedAt) + (p.receiptId ? ' · Receipt ' + p.receiptId : ''),
        ),
        node(
          'p',
          '',
          'Recovery checks the original row and completes the saved operation without adding a duplicate.',
        ),
      );
      const recover = button('Check interrupted save', () =>
        confirmAction(
          { action: 'recover' },
          'Recover the interrupted save?',
          'This resumes the saved submission or admin change. It does not discard an uncertain write.',
        ),
      );
      recover.disabled = !p.canRecover;
      box.append(recover);
      if (!p.canRecover)
        box.append(node('p', '', 'Wait two minutes after the operation started, then refresh.'));
      issues.append(box);
    }
    for (const issue of s.issues) {
      const box = node('div', 'admin-issue');
      box.append(
        node('p', '', issue.message),
        node('p', 'admin-meta', 'Receipt ' + issue.receiptId),
      );
      issues.append(box);
    }
    if (!issues.children.length) empty(issues, 'No interrupted saves or roster mismatches found.');
  }
  function renderAudit() {
    const target = el('adminAudit');
    target.replaceChildren();
    for (const a of data.audit) {
      const row = node('article', 'admin-row'),
        info = node('div', '');
      info.append(
        node('h3', '', labels[a.action] || a.action),
        node('p', '', a.reason),
        node('p', '', a.actor_email + ' · ' + date(a.created_at)),
      );
      if (a.details.playerName) info.append(node('p', '', a.details.playerName));
      if (a.details.email) info.append(node('p', '', a.details.email));
      if (a.action === 'setOpen')
        info.append(node('p', '', a.details.open ? 'Draft opened' : 'Draft closed'));
      if (a.receipt_id) info.append(node('p', 'admin-meta', 'Receipt ' + a.receipt_id));
      row.append(info);
      target.append(row);
    }
    if (!target.children.length) empty(target, 'Admin changes will appear here.');
  }
  function confirmAction(payload, title, details) {
    if (mutating) return;
    action = payload;
    el('adminConfirmTitle').textContent = title;
    el('adminConfirmDetails').textContent = details;
    el('adminReason').value = '';
    el('adminConfirmError').hidden = true;
    el('adminTargetWrap').hidden = payload.action !== 'linkRoster';
    if (payload.action === 'linkRoster') {
      const select = el('adminTarget');
      select.replaceChildren();
      const blank = node('option', '', 'Choose an account');
      blank.value = '';
      select.append(blank);
      for (const m of data.members.filter((m) => m.email_verified && !m.hasRoster)) {
        const option = node('option', '', (m.display_name ? m.display_name + ' · ' : '') + m.email);
        option.value = m.uid;
        select.append(option);
      }
      select.required = true;
    } else el('adminTarget').required = false;
    el('adminConfirm').showModal();
    el('adminReason').focus();
  }
  el('adminConfirmForm').onsubmit = async (event) => {
    event.preventDefault();
    if (mutating || !action) return;
    const payload = { ...action, reason: el('adminReason').value.trim() };
    if (!payload.reason) return;
    if (action.action === 'linkRoster') payload.uid = el('adminTarget').value;
    mutating = true;
    el('adminConfirmSubmit').disabled = true;
    el('adminCancel').disabled = true;
    el('adminConfirmError').hidden = true;
    try {
      const result = await window.leagueAccount.api('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      el('adminConfirm').close();
      message(result.message || 'Change saved.');
      await load();
    } catch (error) {
      el('adminConfirmError').textContent = error.message;
      el('adminConfirmError').hidden = false;
    } finally {
      mutating = false;
      el('adminConfirmSubmit').disabled = false;
      el('adminCancel').disabled = false;
      if (data) render();
    }
  };
  el('adminCancel').onclick = () => el('adminConfirm').close();
  el('adminConfirm').addEventListener('cancel', (event) => {
    if (mutating) event.preventDefault();
  });
  el('adminRefresh').onclick = () => {
    message('');
    load();
  };
  el('adminRosterSearch').oninput = () => {
    if (data) renderEntries();
  };
  el('adminMemberSearch').oninput = () => {
    if (data) renderMembers();
  };
  for (const b of document.querySelectorAll('[data-admin-tab]'))
    b.onclick = () => {
      for (const tab of document.querySelectorAll('[data-admin-tab]')) {
        const selected = tab === b;
        tab.setAttribute('aria-pressed', String(selected));
        el('adminSection-' + tab.dataset.adminTab).hidden = !selected;
      }
    };
  for (const b of document.querySelectorAll('[data-theme-choice]')) {
    b.setAttribute(
      'aria-pressed',
      String(b.dataset.themeChoice === document.documentElement.dataset.theme),
    );
    b.onclick = () => {
      document.documentElement.dataset.theme = b.dataset.themeChoice;
      for (const other of document.querySelectorAll('[data-theme-choice]'))
        other.setAttribute('aria-pressed', String(other === b));
      try {
        localStorage.setItem('ftc-theme', b.dataset.themeChoice);
      } catch {}
    };
  }
  document.addEventListener('league-account-change', accountChanged);
  accountChanged();
})();
