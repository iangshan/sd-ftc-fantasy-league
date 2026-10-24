(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const number = value => value === null || value === undefined ? '—' : value.toFixed(2);
  let data = null, loading = false;
  const selected = new Set();
  const pickedTeams = () => data ? [...selected].map(id => data.teams.find(team => team.id === id)).filter(Boolean) : [];
  const pollenUsed = () => pickedTeams().reduce((sum, team) => sum + team.price, 0);

  function selectTeam(team) {
    if (selected.has(team.id)) selected.delete(team.id);
    else if (selected.size < 3 && pollenUsed() + team.price <= 15) selected.add(team.id);
    renderTeams();
    renderCalculator();
  }
  function renderCalculator() {
    const teams = pickedTeams(), list = el('rosterPicks');
    list.replaceChildren();
    for (let index = 0; index < 3; index++) {
      const team = teams[index], row = node('li', undefined, team ? 'filled' : '');
      row.append(node('span', String(index + 1).padStart(2, '0'), 'slot-num'));
      if (team) {
        const info = node('div', undefined, 'pick-info');
        info.append(node('strong', team.name), node('small', `#${team.number} · ${team.price} pollen · ${team.predictionPoints === null ? 'Unscored' : number(team.predictionPoints) + ' pts'}`));
        const remove = node('button', '×', 'remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${team.name}`);
        remove.onclick = () => selectTeam(team);
        row.append(info, remove);
      } else row.append(node('span', 'Choose a team', 'subtle'));
      list.append(row);
    }
    el('pollenUsed').textContent = String(pollenUsed());
    const missing = teams.filter(team => team.predictionPoints === null).length;
    const points = teams.reduce((sum, team) => sum + (team.predictionPoints ?? 0), 0);
    el('rosterPoints').textContent = !teams.length || missing ? '—' : number(points);
    el('projectionLabel').textContent = missing ? 'Prediction incomplete' : 'Predicted roster points';
    el('projectionNote').textContent = !teams.length ? 'Select a team to start.' : missing ? `${missing} team${missing === 1 ? ' has' : 's have'} no DECODE data. Known subtotal: ${number(points)} pts.` : 'Sum of the selected teams’ prediction points. No entry has been saved.';
    el('clearRoster').disabled = !selected.size;
  }
  function renderTeams() {
    if (!data) return;
    const query = el('teamSearch').value.trim().toLowerCase(), price = el('priceFilter').value;
    const teams = data.teams.filter(team => (!query || `${team.number} ${team.name}`.toLowerCase().includes(query)) && (price === 'all' || String(team.price) === price) && (!el('scoredOnly').checked || team.predictionPoints !== null));
    if (el('sortOrder').value === 'value') teams.sort((a, b) => (b.pointsPerPollen ?? -Infinity) - (a.pointsPerPollen ?? -Infinity) || a.number - b.number);
    const rows = el('teamRows');
    rows.replaceChildren();
    for (const team of teams) {
      const row = node('tr');
      row.dataset.teamId = team.id;
      const name = node('td', undefined, 'team-cell');
      name.append(node('strong', team.name), node('small', `#${team.number} · ${team.price} pollen`));
      const points = node('td', undefined, 'num points');
      points.append(node('span', team.predictionPoints === null ? 'Unscored' : number(team.predictionPoints), team.predictionPoints === null ? 'score-note' : ''));
      const peak = node('td', number(team.highestOpr), 'num');
      if (team.peakCapped) peak.title = `Peak contribution capped at ${number(team.peakUsed)} OPR.`;
      const pickCell = node('td'), pick = node('button', selected.has(team.id) ? '−' : '+', 'pick');
      pick.type = 'button';
      pick.setAttribute('aria-label', `${selected.has(team.id) ? 'Remove' : 'Add'} ${team.number} ${team.name}`);
      pick.setAttribute('aria-pressed', String(selected.has(team.id)));
      pick.disabled = !selected.has(team.id) && (selected.size >= 3 || pollenUsed() + team.price > 15);
      pick.onclick = () => selectTeam(team);
      pickCell.append(pick);
      row.append(node('td', team.rank === null ? '—' : String(team.rank), 'rank'), name, node('td', number(team.averageOpr), 'num'), peak, points, node('td', number(team.pointsPerPollen), 'num'), pickCell);
      rows.append(row);
    }
    el('noTeams').hidden = teams.length !== 0;
    el('teamCaption').textContent = `${teams.length} of ${data.counts.total} eligible teams · Model ranks by prediction points`;
  }
  function renderRosters() {
    const rows = el('rosterRows');
    rows.replaceChildren();
    const unavailable = data.rosterStatus !== 'available';
    el('rosterStatus').hidden = !unavailable;
    el('rosterStatus').textContent = unavailable ? 'Saved test rosters could not be loaded. Team predictions and the temporary roster calculator are still available. Use Refresh data to retry.' : '';
    el('noRosters').hidden = unavailable || data.rosters.length > 0;
    for (const roster of data.rosters) {
      const row = node('tr'), name = node('td', undefined, 'team-cell'), points = node('td', undefined, 'num points');
      name.append(node('strong', roster.label));
      if (roster.reason) name.append(node('small', roster.reason));
      points.append(node('span', roster.predictionPoints === null ? 'Unranked' : number(roster.predictionPoints), roster.predictionPoints === null ? 'score-note' : ''));
      if (roster.status === 'incomplete') points.append(node('small', `Known: ${number(roster.knownPoints)}`, 'score-note'));
      row.append(node('td', roster.rank === null ? '—' : String(roster.rank), 'rank'), name, node('td', roster.teams.map(team => '#' + team.number).join(', ') || '—'), node('td', roster.totalPollen === null ? '—' : String(roster.totalPollen), 'num'), points);
      rows.append(row);
    }
  }
  async function load() {
    if (loading) return;
    loading = true;
    el('refresh').disabled = true;
    el('loadStatus').hidden = false;
    el('loadStatus').textContent = data ? 'Refreshing prediction data…' : 'Loading prediction points…';
    try {
      const response = await fetch('/api/admin/predictions', {cache: 'no-store', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Owner sign-in is required. Sign in again to view predictions.' : 'Predictions could not be loaded. Use Refresh data to retry.');
      const result = await response.json();
      if (!Array.isArray(result.teams) || !Array.isArray(result.rosters) || !result.model || !result.counts) throw new Error('Prediction data was incomplete. Use Refresh data to retry.');
      data = result;
      for (const id of selected) if (!data.teams.some(team => team.id === id)) selected.delete(id);
      el('scoredCount').textContent = String(data.counts.scored);
      el('poolCount').textContent = `${data.counts.total} teams in the eligible pool`;
      el('unscoredCount').textContent = String(data.counts.unscored);
      const baseline = data.teams.find(team => team.id === data.baseline.teamId);
      el('baselineTeam').textContent = baseline && data.baseline.strength > 0 ? `#${baseline.number} ${baseline.name}` : 'No positive baseline';
      el('updatedAt').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      el('modelVersion').textContent = 'Model ' + data.model.version;
      renderTeams(); renderCalculator(); renderRosters();
      el('loadStatus').hidden = true;
    } catch (error) {
      el('loadStatus').textContent = (error.name === 'TimeoutError' ? 'Loading timed out. Use Refresh data to retry.' : error.message) + (data ? ' Previously loaded results are still shown.' : '');
    } finally { loading = false; el('refresh').disabled = false; }
  }
  for (const id of ['teamSearch', 'priceFilter', 'sortOrder', 'scoredOnly']) el(id).addEventListener(id === 'teamSearch' ? 'input' : 'change', renderTeams);
  for (const [buttonId, panelId] of [['teamTab', 'teamPanel'], ['rosterTab', 'rosterPanel']]) {
    el(buttonId).onclick = () => {
      for (const [button, panel] of [['teamTab', 'teamPanel'], ['rosterTab', 'rosterPanel']]) {
        el(button).setAttribute('aria-pressed', String(button === buttonId));
        el(panel).hidden = panel !== panelId;
      }
    };
  }
  el('clearRoster').onclick = () => { selected.clear(); renderTeams(); renderCalculator(); };
  el('refresh').onclick = load;
  renderCalculator();
  load();
})();
