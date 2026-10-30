(() => {
  'use strict';
  const el = (id) => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const view =
    location.pathname === '/admin'
      ? 'admin'
      : location.pathname === '/dashboard'
        ? 'roster'
        : 'draft';
  let data,
    busy = false,
    selected = new Set();
  const number = (value) => (value === null ? 'Not measured' : value.toFixed(1));
  const say = (text) => {
    el('frcMessage').textContent = text;
  };
  async function api(path, body) {
    const response = await fetch(path, {
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
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  }
  async function load() {
    const next = await api('/api/frc');
    if (data && data.catalogVersion !== next.catalogVersion) selected.clear();
    data = next;
    if (data.roster) selected.clear();
    render();
  }
  async function perform(path, body) {
    if (busy || !data) return;
    busy = true;
    render();
    say('Working…');
    try {
      const result = await api(path, { contextLeagueId: data.leagueId, ...body });
      await load();
      say(result.message || 'Saved.');
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
      if (data) render();
    }
  }
  function renderTeams() {
    const query = el('frcSearch').value.trim().toLowerCase();
    const teams = data.catalog.filter((team) =>
      `${team.number} ${team.name}`.toLowerCase().includes(query),
    );
    teams.sort(
      el('frcSort').value === 'number'
        ? (a, b) => a.number - b.number
        : el('frcSort').value === 'opr'
          ? (a, b) => (b.opr ?? -Infinity) - (a.opr ?? -Infinity) || a.number - b.number
          : (a, b) => b.price - a.price || a.number - b.number,
    );
    const total = data.catalog
      .filter((team) => selected.has(team.number))
      .reduce((sum, team) => sum + team.price, 0);
    const grid = el('frcTeams');
    grid.replaceChildren();
    for (const team of teams) {
      const chosen = selected.has(team.number);
      const card = node('article', undefined, 'frc-team' + (chosen ? ' selected' : ''));
      card.append(
        node('small', `TEAM ${team.number}`),
        node('h3', team.name),
        node('strong', `${team.price} Pollen`, 'frc-price'),
        node('p', `2026 REBUILT OPR: ${number(team.opr)}`),
        node(
          'p',
          team.measuredEvents
            ? `Foul-adjusted · ${team.measuredEvents} measured event${team.measuredEvents === 1 ? '' : 's'}`
            : 'Provisional price · no measured history',
        ),
      );
      const link = node('a', 'Team on The Blue Alliance');
      link.href = `https://www.thebluealliance.com/team/${team.number}/2026`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const button = node('button', chosen ? 'Remove from roster' : 'Add to roster');
      button.type = 'button';
      button.dataset.frcTeam = team.number;
      button.setAttribute('aria-pressed', String(chosen));
      button.disabled =
        busy ||
        Boolean(data.roster) ||
        (!chosen && (selected.size >= data.maxTeams || total + team.price > data.budget));
      button.onclick = () => {
        if (chosen) selected.delete(team.number);
        else selected.add(team.number);
        renderDraft();
      };
      card.append(link, button);
      grid.append(card);
    }
    if (!teams.length)
      grid.append(
        node(
          'p',
          data.catalog.length
            ? 'No teams match your search.'
            : 'The team pool is waiting for its first TBA import. Your league administrator can connect it from FRC admin.',
          'muted',
        ),
      );
  }
  function renderDraft() {
    renderTeams();
    const picks = data.catalog.filter((team) => selected.has(team.number));
    el('frcRemaining').textContent = data.budget - picks.reduce((sum, team) => sum + team.price, 0);
    const list = el('frcPicks');
    list.replaceChildren();
    for (const team of picks) {
      const row = node('div', undefined, 'frc-pick');
      row.append(node('strong', `#${team.number} ${team.name}`), node('p', `${team.price} Pollen`));
      list.append(row);
    }
    if (!picks.length)
      list.append(
        node(
          'p',
          data.roster
            ? 'You already have a saved roster. Open My roster to view it.'
            : 'Choose up to three teams from the board.',
          'muted',
        ),
      );
    el('frcSubmit').disabled = busy || !data.open || Boolean(data.roster) || !picks.length;
    el('frcSubmit').textContent = data.roster
      ? 'Roster already saved'
      : data.open
        ? 'Save test roster'
        : 'Test drafting is closed';
  }
  function renderRoster() {
    const target = el('frcSavedRoster');
    target.replaceChildren();
    if (!data.roster) {
      target.append(node('p', 'You have not saved a test roster yet.'));
      const link = node('a', 'Open the draft board');
      link.href = '/';
      target.append(link);
    } else {
      for (const team of data.roster.picks)
        target.append(node('p', `#${team.number} ${team.name} · ${team.price} Pollen`));
      target.append(
        node('strong', `${data.roster.total} / ${data.budget} Pollen`),
        node('p', `2027 earned points: ${number(data.roster.points)}`),
        node(
          'p',
          `Saved ${new Date(data.roster.submittedAt).toLocaleString()} · Receipt ${data.roster.receiptId}`,
          'muted',
        ),
      );
      if (data.open) {
        const reset = node('button', 'Reset my staging test roster');
        reset.type = 'button';
        reset.disabled = busy;
        reset.onclick = () => {
          if (
            confirm('Reset only your own staging test roster so you can try another combination?')
          )
            perform('/api/frc/reset', {});
        };
        target.append(reset);
      }
    }
    const standings = el('frcStandings');
    standings.replaceChildren();
    const finished = data.events.some(
      (event) =>
        event.season === data.season &&
        event.status === 'complete' &&
        data.scoringEvents.includes(event.key),
    );
    if (!finished)
      standings.append(node('p', '2027 points will appear after a counted event finishes.'));
    else
      for (const entry of data.standings) {
        const row = node('div', undefined, 'frc-standing');
        row.append(
          node('span', `${entry.rank}. ${entry.displayName}${entry.yours ? ' (you)' : ''}`),
          node('strong', number(entry.points)),
        );
        standings.append(row);
      }
  }
  function renderAdmin() {
    if (!data.canAdmin) return;
    el('frcConnection').textContent = data.admin.tbaConfigured
      ? 'The TBA read key is connected. Import the participant list and qualification results.'
      : 'TBA is not connected yet. Add the read key using the steps below.';
    el('frcConnectHelp').open = !data.admin.tbaConfigured;
    el('frcSyncError').hidden = !data.admin.syncError;
    el('frcSyncError').textContent = data.admin.syncError || '';
    el('frcSync').disabled = busy || !data.admin.tbaConfigured || data.refreshing;
    el('frcSetOpen').textContent = data.admin.draftOpen
      ? 'Close test drafting'
      : 'Open test drafting';
    el('frcSetOpen').disabled =
      busy ||
      (!data.admin.draftOpen &&
        (!data.catalog.length || data.refreshing || data.admin.eventStarted));
    el('frcOpenHelp').textContent =
      `${data.admin.rosterCount} saved staging roster${data.admin.rosterCount === 1 ? '' : 's'}. ${data.poolStatus === 'provisional' ? 'This uses a provisional 2026 field, pending the 2027 participant list.' : 'Review the participant list and event choices before opening.'}`;
    el('frcTargetEvent').value = data.targetEvent;
    el('frcHistoryEvents').value = data.historyEvents.join(', ');
    el('frcScoringEvents').value = data.scoringEvents.join(', ');
    el('frcSettingsForm')
      .querySelectorAll('input,button')
      .forEach((element) => {
        element.disabled = busy || data.admin.rosterCount > 0 || data.refreshing;
      });
  }
  function render() {
    el('frcContent').hidden = false;
    el('frcTitle').textContent =
      view === 'admin'
        ? 'FRC setup & data.'
        : view === 'roster'
          ? 'Your 2027 roster.'
          : 'Build your 2027 roster.';
    el('frcDraftView').hidden = view !== 'draft';
    el('frcRosterView').hidden = view !== 'roster';
    el('frcAdminView').hidden = view !== 'admin' || !data.canAdmin;
    el('frcPoolStatus').textContent =
      data.poolStatus === 'confirmed'
        ? '2027 field available'
        : data.poolStatus === 'provisional'
          ? '2026 field · provisional'
          : 'Awaiting team data';
    el('frcDraftStatus').textContent = data.open ? 'Test drafting open' : 'Closed';
    el('frcUpdated').textContent = data.lastSyncAt
      ? new Date(data.lastSyncAt).toLocaleString()
      : 'Not imported yet';
    el('frcPoolNote').textContent =
      data.poolStatus === 'provisional'
        ? 'The 2027 participant list has not been published by the data provider. These are 2026 San Diego Regional participants for staging review; their 2027 participation is not confirmed.'
        : data.poolStatus === 'confirmed'
          ? `All ${data.catalog.length} teams listed for ${data.targetEvent}. The field may change before the event.`
          : 'Teams will appear after your league administrator connects competition data.';
    el('frcEventNote').textContent =
      `2026 pricing events: ${data.historyEvents.join(', ')}. Counted 2027 events: ${data.scoringEvents.join(', ')}.`;
    if (view === 'draft') renderDraft();
    if (view === 'roster') renderRoster();
    if (view === 'admin') renderAdmin();
    el('frcRefresh').disabled = busy;
  }
  el('frcSearch').oninput = () => {
    if (data) renderTeams();
  };
  el('frcSort').onchange = () => {
    if (data) renderTeams();
  };
  el('frcDraftForm').onsubmit = (event) => {
    event.preventDefault();
    if (!data || !el('frcDraftForm').reportValidity()) return;
    perform('/api/frc/submit', {
      season: data.season,
      catalogVersion: data.catalogVersion,
      teamNumbers: [...selected],
      displayName: el('frcDisplayName').value.trim(),
    });
  };
  el('frcSync').onclick = () => perform('/api/frc/admin', { action: 'sync' });
  el('frcSetOpen').onclick = () =>
    perform('/api/frc/admin', { action: 'setOpen', open: !data.admin.draftOpen });
  el('frcSettingsForm').onsubmit = (event) => {
    event.preventDefault();
    const list = (id) =>
      el(id)
        .value.split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    perform('/api/frc/admin', {
      action: 'configure',
      eventKey: el('frcTargetEvent').value.trim(),
      historyEvents: list('frcHistoryEvents'),
      scoringEvents: list('frcScoringEvents'),
    });
  };
  el('frcRefresh').onclick = () =>
    load()
      .then(() => say(data.dataWarning || ''))
      .catch((error) => say(error.message));
  load()
    .then(() => say(data.dataWarning || ''))
    .catch((error) => say(error.message));
})();
