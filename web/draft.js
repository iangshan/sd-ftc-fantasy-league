(function () {
  'use strict';
  const el = (id) => document.getElementById(id);
  const state = {
    catalog: [],
    selected: [],
    budget: 15,
    maxTeams: 3,
    priceVersion: '',
    open: false,
    loading: true,
    submitting: false,
    priceFilter: 'all',
    preview: false,
    token: makeToken(),
    accountEpoch: 0,
  };
  const pollen = (value) =>
    Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' pollen';
  const opr = (value) =>
    value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
      ? '—'
      : Number(value).toFixed(2);
  function makeToken() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function')
      return window.crypto.randomUUID();
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
    }
    return (
      'draft_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    );
  }
  function node(tag, className, content) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== undefined) item.textContent = content;
    return item;
  }
  function selectedTeams() {
    return state.selected.map((id) => state.catalog.find((t) => t.id === id)).filter(Boolean);
  }
  function total() {
    return selectedTeams().reduce((sum, t) => sum + t.price, 0);
  }
  function announce(message) {
    el('liveAnnouncement').textContent = message;
  }
  function message(text) {
    el('formMessage').textContent = text;
    el('formMessage').hidden = !text;
  }
  function normalizeData(data) {
    if (!data || !Array.isArray(data.catalog))
      throw new Error('The team list could not be loaded. Please try again.');
    const budget = Number(data.budget),
      maxTeams = Number(data.maxTeams);
    if (!Number.isFinite(budget) || budget <= 0 || !Number.isInteger(maxTeams) || maxTeams < 1)
      throw new Error('The draft settings are unavailable. Please contact your organizer.');
    const seen = new Set();
    const catalog = data.catalog
      .map((t) => {
        const id = String(t.id == null ? t.number : t.id);
        const price = t.price === null || t.price === undefined ? null : Number(t.price);
        if (!id || id === 'undefined' || seen.has(id))
          throw new Error('The team list needs an organizer update. Please try again later.');
        seen.add(id);
        return {
          id,
          number: Number(t.number),
          name: String(t.name || 'Team ' + t.number),
          averageOpr: t.averageOpr,
          highestOpr: t.highestOpr,
          rank: t.rank,
          price,
          available: t.available !== false && Number.isFinite(price) && price > 0,
        };
      })
      .filter((t) => t.available);
    return {
      catalog,
      budget,
      maxTeams,
      open: data.open === true,
      priceVersion: String(data.priceVersion || ''),
    };
  }
  function receiveData(data) {
    try {
      Object.assign(state, normalizeData(data), { loading: false, preview: data.preview === true });
      el('previewNotice').hidden = !state.preview;
      ['playerName', 'playerTeamName', 'discordId'].forEach((id) => {
        el(id).disabled = state.preview;
      });
      state.selected = state.selected.filter((id) =>
        state.catalog.some((t) => t.id === id && t.available),
      );
      el('errorNotice').hidden = true;
      el('introCopy').textContent = 'Pick your teams. Stay within budget. Make the season yours.';
      el('heroBudget').textContent = String(state.budget);
      el('heroTeams').textContent = '1–' + state.maxTeams;
      el('heroPool').textContent = state.catalog.length;
      el('selectionTip').textContent =
        'Pick 1 to ' + state.maxTeams + ' teams. You don’t have to spend your full budget.';
      el('statusNotice').textContent = state.open
        ? ''
        : 'The draft is currently closed. You can browse the team pool; entries are not being accepted.';
      el('statusNotice').hidden = state.open;
      renderAll();
    } catch (error) {
      loadFailed(error);
    }
  }
  function loadFailed(error) {
    state.loading = false;
    state.open = false;
    const notice = el('errorNotice');
    notice.replaceChildren(
      node(
        'span',
        '',
        error && error.message ? error.message : 'We couldn’t load the draft. Please try again.',
      ),
    );
    const retry = node('button', 'reload-button', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', loadData);
    notice.appendChild(retry);
    notice.hidden = false;
    el('teamGrid').replaceChildren(node('div', 'empty', 'The team pool is currently unavailable.'));
    el('teamCount').textContent = 'Unable to load teams';
    updateSubmit();
  }
  function renderAll() {
    renderTeams();
    renderRoster();
    updateSubmit();
  }
  function renderTeams() {
    const search = el('teamSearch').value.trim().toLowerCase();
    const filtered = state.catalog.filter(
      (t) =>
        (!search || t.name.toLowerCase().includes(search) || String(t.number).includes(search)) &&
        (state.priceFilter === 'all' || t.price === Number(state.priceFilter)),
    );
    const mode = el('sortTeams').value;
    filtered.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (mode === 'number') return a.number - b.number;
      if (mode === 'name') return a.name.localeCompare(b.name);
      if (mode === 'price')
        return (
          (a.price ?? Infinity) - (b.price ?? Infinity) ||
          Number(b.averageOpr ?? -Infinity) - Number(a.averageOpr ?? -Infinity)
        );
      return (
        Number(b.averageOpr ?? -Infinity) - Number(a.averageOpr ?? -Infinity) || a.number - b.number
      );
    });
    el('teamCount').textContent =
      search || state.priceFilter !== 'all'
        ? filtered.length + ' teams shown'
        : state.catalog.length + ' teams available';
    const grid = el('teamGrid');
    grid.replaceChildren();
    if (!filtered.length) {
      const empty = node('div', 'empty');
      empty.append(
        node('strong', '', 'No matching teams.'),
        node('span', '', 'Try another name, number, or pollen cost.'),
      );
      grid.appendChild(empty);
      return;
    }
    const spent = total(),
      showHighest = el('showHighest').checked;
    filtered.forEach((team) => {
      const isSelected = state.selected.includes(team.id);
      const cannotAfford = team.available && team.price + spent > state.budget;
      const full = state.selected.length >= state.maxTeams;
      const card = node(
        'article',
        'team-card' + (isSelected ? ' selected' : '') + (!team.available ? ' unavailable' : ''),
      );
      const top = node('div', 'card-top');
      top.append(
        node('span', 'team-number', '#' + team.number),
        node(
          'span',
          'rank',
          team.available && team.rank ? '#' + team.rank + ' by avg. OPR' : 'No OPR data',
        ),
      );
      card.append(top, node('h3', 'card-title', team.name));
      const stat = node('div', 'team-opr');
      stat.append(
        node('span', 'stat-label', 'DECODE avg. OPR'),
        node('strong', '', opr(team.averageOpr)),
      );
      card.appendChild(stat);
      const bottom = node('div', 'card-bottom');
      const button = node('button', 'add-team');
      button.type = 'button';
      button.dataset.teamId = team.id;
      button.disabled =
        state.submitting ||
        (!isSelected && (!state.open || !team.available || cannotAfford || full));
      button.setAttribute('aria-pressed', String(isSelected));
      button.setAttribute(
        'aria-label',
        (isSelected ? 'Remove ' : 'Add ') +
          team.number +
          ' ' +
          team.name +
          (team.available ? ', ' + pollen(team.price) : ', unavailable'),
      );
      if (team.available) {
        button.append(
          node('span', '', pollen(team.price)),
          node('span', 'plus', isSelected ? '−' : '+'),
        );
      } else button.textContent = 'No data';
      button.addEventListener('click', () => toggleTeam(team.id));
      bottom.append(button);
      card.appendChild(bottom);
      const reason = !team.available
        ? 'No event OPR available'
        : isSelected
          ? 'On your roster'
          : !state.open
            ? 'Draft closed'
            : full
              ? 'Your roster is full'
              : cannotAfford
                ? 'Over remaining budget'
                : 'Available to draft';
      card.appendChild(node('p', 'card-reason', reason));
      if (showHighest)
        card.appendChild(node('div', 'peak', 'Highest event OPR: ' + opr(team.highestOpr)));
      grid.appendChild(card);
    });
  }
  function toggleTeam(id) {
    if (state.submitting) return;
    const team = state.catalog.find((t) => t.id === id);
    if (!team) return;
    const isSelected = state.selected.includes(id);
    if (isSelected) {
      state.selected = state.selected.filter((value) => value !== id);
      announce(team.name + ' removed.');
    } else {
      if (!state.open || !team.available) return;
      if (state.selected.length >= state.maxTeams) {
        announce('You can choose up to ' + state.maxTeams + ' teams.');
        return;
      }
      if (total() + team.price > state.budget) {
        announce('That team would exceed your draft budget.');
        return;
      }
      state.selected.push(id);
      announce(team.name + ' added. ' + pollen(state.budget - total()) + ' remaining.');
    }
    message('');
    renderAll();
    const nextButton = Array.from(el('teamGrid').querySelectorAll('button[data-team-id]')).find(
      (button) => button.dataset.teamId === id,
    );
    if (nextButton && !nextButton.disabled) nextButton.focus({ preventScroll: true });
  }
  function renderRoster() {
    const teams = selectedTeams(),
      spent = total(),
      remaining = state.budget - spent;
    el('slotsCount').textContent = teams.length + ' / ' + state.maxTeams + ' teams';
    el('budgetRemaining').textContent = String(remaining);
    el('budgetSpent').textContent = String(spent);
    el('budgetTotal').textContent = String(state.budget);
    el('budgetFill').style.width = Math.min(100, (spent / state.budget) * 100) + '%';
    el('budgetProgress').setAttribute('aria-valuemax', String(state.budget));
    el('budgetProgress').setAttribute('aria-valuenow', String(spent));
    el('mobileRosterCount').textContent =
      teams.length + ' / ' + state.maxTeams + ' teams · ' + pollen(remaining) + ' left ↓';
    const list = el('rosterList');
    list.replaceChildren();
    for (let i = 0; i < state.maxTeams; i++) {
      const team = teams[i],
        slot = node('li', 'roster-slot' + (team ? ' filled' : ''));
      slot.appendChild(node('span', 'slot-number', i + 1));
      if (team) {
        const info = node('div', 'slot-info');
        info.append(
          node('div', 'slot-name', team.name),
          node('div', 'slot-team', '#' + team.number),
        );
        const remove = node('button', 'remove-team', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + team.name + ' from roster');
        remove.disabled = state.submitting;
        remove.addEventListener('click', () => {
          toggleTeam(team.id);
          const next = el('rosterList').querySelector('button');
          if (next) next.focus({ preventScroll: true });
        });
        slot.append(info, node('span', 'slot-price', pollen(team.price)), remove);
      } else slot.appendChild(node('span', 'slot-hint', 'No team selected'));
      list.appendChild(slot);
    }
  }
  function updateSubmit() {
    const button = el('submitDraft'),
      hasTeams = state.selected.length > 0;
    const fieldsReady = ['playerName', 'playerTeamName', 'discordId'].every(
      (id) => el(id).value.trim().length > 0,
    );
    const account = window.leagueAccount;
    const accountReady =
      account?.user?.emailVerified &&
      account?.data &&
      !account.data.roster &&
      !account.data.pending;
    button.disabled =
      !accountReady ||
      state.loading ||
      state.submitting ||
      !state.open ||
      !hasTeams ||
      !fieldsReady ||
      total() > state.budget ||
      state.selected.length > state.maxTeams ||
      state.preview;
    button.textContent = !account?.user
      ? 'Sign in to submit'
      : !account.user.emailVerified
        ? 'Verify your email to submit'
        : account.data?.roster
          ? 'Roster already submitted'
          : account.data?.pending
            ? 'Check your save in My dashboard'
            : !account.data
              ? 'Account is loading'
              : state.submitting
                ? 'Submitting your roster…'
                : state.preview
                  ? 'Preview only · submissions disabled'
                  : state.loading
                    ? 'Loading the draft…'
                    : !state.open
                      ? 'Draft closed'
                      : !hasTeams
                        ? 'Choose your teams to continue'
                        : !fieldsReady
                          ? 'Add your details to submit'
                          : 'Submit roster · ' + pollen(total());
  }
  async function submit(event) {
    event.preventDefault();
    if (
      state.submitting ||
      state.preview ||
      state.loading ||
      !state.open ||
      !window.leagueAccount?.user?.emailVerified ||
      !window.leagueAccount?.data ||
      window.leagueAccount.data.roster ||
      window.leagueAccount.data.pending
    )
      return;
    if (!el('draftForm').reportValidity()) return;
    const teams = selectedTeams();
    if (
      teams.length < 1 ||
      teams.length > state.maxTeams ||
      total() > state.budget ||
      teams.some((t) => !t.available)
    ) {
      message(
        'Choose 1 to ' +
          state.maxTeams +
          ' available teams within your ' +
          pollen(state.budget) +
          ' budget.',
      );
      return;
    }
    const payload = {
      playerName: el('playerName').value.trim(),
      playerTeamName: el('playerTeamName').value.trim(),
      discordId: el('discordId').value.trim(),
      teamIds: teams.map((t) => t.id),
      priceVersion: state.priceVersion,
      submissionToken: state.token,
    };
    if (!payload.playerName || !payload.playerTeamName || !payload.discordId) {
      message('Please complete all three player details.');
      return;
    }
    if (
      [payload.playerName, payload.playerTeamName, payload.discordId].some((value) =>
        /[\u0000-\u001F\u007F]/.test(value),
      )
    ) {
      message('Please remove line breaks or hidden control characters from your details.');
      return;
    }
    const accountEpoch = state.accountEpoch;
    state.submitting = true;
    message('');
    renderAll();
    ['playerName', 'playerTeamName', 'discordId'].forEach((id) => {
      el(id).disabled = true;
    });
    try {
      const result = await api('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (accountEpoch === state.accountEpoch) submitted(result, teams);
    } catch (error) {
      if (accountEpoch === state.accountEpoch) submitFailed(error);
    }
  }
  function submitFailed(error) {
    state.submitting = false;
    ['playerName', 'playerTeamName', 'discordId'].forEach((id) => {
      el(id).disabled = false;
    });
    message(
      error && error.message
        ? error.message
        : 'We couldn’t confirm your submission. Keep your selections and try again. Retrying won’t create a second entry.',
    );
    renderAll();
    el('formMessage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    announce('Your roster was not confirmed. Please read the submission message.');
  }
  function submitted(result, teams) {
    if (!result || result.ok !== true || !result.receiptId) {
      submitFailed(
        new Error('We couldn’t confirm your entry. Keep your selections and try again.'),
      );
      return;
    }
    state.submitting = false;
    state.token = makeToken();
    el('draftLayout').hidden = true;
    el('statusNotice').hidden = true;
    const list = el('successRoster');
    list.replaceChildren();
    const returnedIds = Array.isArray(result.teamIds) ? result.teamIds.map(String) : [];
    const saved = window.leagueAccount?.data?.roster;
    const recorded = saved?.receipt?.receiptId === result.receiptId ? saved.teams : null;
    // An idempotent retry can return an older receipt. Only display per-team
    // paid costs when the saved snapshot or this exact quote proves them.
    const paidTeams = Array.isArray(recorded)
      ? recorded
      : result.priceVersion === state.priceVersion
        ? teams
        : [];
    const paid = new Map(paidTeams.map((team) => [String(team.id ?? team.number), team]));
    const paidKnown =
      returnedIds.length > 0 &&
      paid.size === returnedIds.length &&
      returnedIds.every((id) => Number.isInteger(paid.get(id)?.price)) &&
      returnedIds.reduce((sum, id) => sum + (paid.get(id)?.price ?? 0), 0) === result.total;
    returnedIds.forEach((id) => {
      const team = paid.get(id) || state.catalog.find((t) => t.id === id);
      const row = node('li', '');
      row.append(
        node('span', '', '#' + id + (team?.name ? ' · ' + team.name : ' · Saved team')),
        node('strong', '', paidKnown ? pollen(paid.get(id).price) : 'Saved'),
      );
      list.appendChild(row);
    });
    el('receiptId').textContent = result.receiptId;
    el('successTotal').textContent = result.total + ' / ' + state.budget + ' pollen';
    el('successPanel').hidden = false;
    el('successPanel').focus();
    el('successPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    ['playerName', 'playerTeamName', 'discordId'].forEach((id) => {
      el(id).value = '';
    });
    announce('Your roster was submitted. You’re entered in the league.');
  }
  async function api(path, options) {
    if (path === '/api/submit') return window.leagueAccount.api(path, options);
    const response = await fetch(path, { ...options, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || 'The request could not be completed. Please try again.');
    return data;
  }
  async function loadData() {
    state.loading = true;
    el('errorNotice').hidden = true;
    updateSubmit();
    try {
      receiveData(await api('/api/draft'));
    } catch (error) {
      loadFailed(error);
    }
  }
  el('teamSearch').addEventListener('input', renderTeams);
  el('sortTeams').addEventListener('change', renderTeams);
  el('showHighest').addEventListener('change', renderTeams);
  document.querySelectorAll('button[data-price]').forEach((button) =>
    button.addEventListener('click', () => {
      state.priceFilter = button.dataset.price;
      document
        .querySelectorAll('button[data-price]')
        .forEach((chip) => chip.setAttribute('aria-pressed', String(chip === button)));
      renderTeams();
    }),
  );
  ['playerName', 'playerTeamName', 'discordId'].forEach((id) =>
    el(id).addEventListener('input', updateSubmit),
  );
  el('jumpToRoster').addEventListener('click', () =>
    el('yourRoster').scrollIntoView({ behavior: 'smooth', block: 'start' }),
  );
  let previousUid = null;
  document.addEventListener('league-account-change', () => {
    const account = window.leagueAccount,
      user = account?.user;
    if (previousUid && previousUid !== user?.uid) {
      state.accountEpoch++;
      state.submitting = false;
      state.token = makeToken();
      state.selected = [];
      el('successPanel').hidden = true;
      el('draftLayout').hidden = false;
      ['playerName', 'playerTeamName', 'discordId'].forEach((id) => {
        el(id).value = '';
        el(id).disabled = state.preview;
      });
      message('');
    }
    previousUid = user?.uid || null;
    el('draftAccountStatus').textContent = !user
      ? 'Sign in to save your roster to your account.'
      : account.data?.roster
        ? 'Your roster is already saved. View it in your dashboard.'
        : account.data?.pending
          ? 'Your entry is being confirmed. Check your dashboard.'
          : !user.emailVerified
            ? 'Verify your email in your dashboard before submitting.'
            : 'Signed in as ' + (user.email || 'your league account');
    el('draftAccountLink').textContent = user ? 'Open my dashboard' : 'Sign in / create account';
    renderAll();
  });
  el('draftForm').addEventListener('submit', submit);
  renderRoster();
  loadData();
})();
