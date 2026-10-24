(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const number = value => Number.isFinite(value) ? value.toFixed(2) : '—';
  const signed = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + number(value) : '—';
  let data = null, loading = false;
  const selected = new Set();
  const plannedEvents = new Map();
  const pickedTeams = () => data ? [...selected].map(id => data.draftTeams.find(team => team.id === id)).filter(Boolean) : [];
  const pollenUsed = () => pickedTeams().reduce((sum, team) => sum + team.price, 0);

  function selectTeam(team) {
    if (selected.has(team.id)) selected.delete(team.id);
    else if (team.draftEligible && selected.size < 3 && pollenUsed() + team.price <= 15) selected.add(team.id);
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
        info.append(node('strong', team.name), node('small', `#${team.number} · Cost: ${team.price} Pollen · ${team.predictionPoints === null ? 'Unscored' : number(team.predictionPoints) + ' PP / event'}`));
        const remove = node('button', '×', 'remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${team.name}`);
        remove.onclick = () => selectTeam(team);
        const plan = node('label', undefined, 'event-plan');
        plan.append(node('span', 'Planned events'));
        const input = node('input');
        input.type = 'number'; input.min = '0'; input.max = '12'; input.step = '1';
        input.inputMode = 'numeric'; input.placeholder = '—';
        input.value = plannedEvents.get(team.id) ?? '';
        input.dataset.plannedTeamId = team.id;
        input.setAttribute('aria-label', `Planned events for ${team.number} ${team.name}`);
        input.addEventListener('input', () => { plannedEvents.set(team.id, input.value); renderScenario(); });
        plan.append(input);
        row.append(info, remove, plan);
      } else row.append(node('span', 'Choose a team', 'subtle'));
      list.append(row);
    }
    el('pollenUsed').textContent = String(pollenUsed());
    el('pollenRemaining').textContent = String(15 - pollenUsed());
    const missing = teams.filter(team => team.predictionPoints === null).length;
    const points = teams.reduce((sum, team) => sum + (team.predictionPoints ?? 0), 0);
    el('rosterPoints').textContent = !teams.length || missing ? '—' : number(points);
    el('projectionLabel').textContent = missing ? 'Prediction incomplete' : 'Roster PP per event';
    el('projectionNote').textContent = !teams.length ? 'Select a team to start.' : missing ? `${missing} team${missing === 1 ? ' has' : 's have'} no DECODE data. Known subtotal: ${number(points)} PP.` : 'One event per selected team, on the DECODE scale. No entry has been saved.';
    el('clearRoster').disabled = !selected.size;
    renderScenario();
  }
  function renderScenario() {
    const teams = pickedTeams();
    let total = 0, missingCounts = 0, invalidCounts = 0, missingScores = 0, eventTotal = 0;
    for (const team of teams) {
      const input = plannedEvents.get(team.id);
      if (input === undefined || input.trim() === '') { missingCounts++; continue; }
      const count = Number(input);
      if (!Number.isInteger(count) || count < 0 || count > 12) { invalidCounts++; continue; }
      eventTotal += count;
      if (count === 0) continue;
      if (!Number.isFinite(team.predictionPoints)) { missingScores++; continue; }
      total += team.predictionPoints * count;
    }
    const complete = teams.length && !missingCounts && !invalidCounts && !missingScores;
    el('scenarioPoints').textContent = complete ? number(total) : '—';
    el('scenarioNote').textContent = !teams.length ? 'Select teams, then enter their planned events.'
      : invalidCounts ? 'Use a whole number from 0 to 12 for each team’s events.'
      : missingCounts ? 'Enter planned events for every selected team; use 0 for no events.'
      : missingScores ? `${missingScores} selected team${missingScores === 1 ? ' needs' : 's need'} an OPR estimate for the planned events.`
      : `${eventTotal} planned team-event${eventTotal === 1 ? '' : 's'} × the corresponding per-event PP. No actual results are included.`;
  }
  function evidenceDetails(team) {
    const evidence = team.evidence ?? {};
    const details = node('details', undefined, 'team-evidence');
    const label = evidence.source === 'event_history'
      ? `${evidence.eventCount} recorded event${evidence.eventCount === 1 ? '' : 's'}`
      : evidence.source === 'summary_only' ? 'Summary only' : 'No historical evidence';
    details.append(node('summary', label));
    const content = node('div', undefined, 'evidence-details');
    content.append(node('p', `Cost: ${team.price} Pollen. Value: ${number(team.pointsPerPollen)} PP per event for every 1 Pollen spent.`));
    content.append(node('p', `Average OPR: ${number(team.averageOpr)} · Best OPR: ${number(team.highestOpr)}`));
    if (evidence.source === 'event_history') {
      content.append(node('p', `Latest OPR: ${number(evidence.lastOpr)} · Recent average: ${number(evidence.recentAverageOpr)} · Trend: ${signed(evidence.trendOprPerEvent)} OPR per event.`));
      content.append(node('p', `Recorded qualification matches: ${evidence.matchCount ?? 'unknown'}. Historical OPR spread: ${number(evidence.spreadOpr)}. Spread describes past variation; it is not a prediction interval.`));
    } else content.append(node('p', evidence.source === 'summary_only' ? 'The historical average provides a fallback estimate. Event counts, recent form, and trend are unavailable.' : 'No measured OPR is available. This team is unscored, rather than assigned zero PP.'));
    details.append(content);
    return details;
  }
  function renderTeams() {
    if (!data) return;
    const query = el('teamSearch').value.trim().toLowerCase(), price = el('priceFilter').value;
    const currentDraft = el('teamScope').value === 'draft';
    const pool = currentDraft ? data.draftTeams : data.teams;
    const teams = pool.filter(team => team.draftEligible && (!query || `${team.number} ${team.name}`.toLowerCase().includes(query)) && (price === 'all' || String(team.price) === price) && (!el('scoredOnly').checked || team.predictionPoints !== null));
    if (el('sortOrder').value === 'value') teams.sort((a, b) => (b.pointsPerPollen ?? -Infinity) - (a.pointsPerPollen ?? -Infinity) || a.number - b.number);
    if (el('sortOrder').value === 'trend') teams.sort((a, b) => (b.evidence?.trendOprPerEvent ?? -Infinity) - (a.evidence?.trendOprPerEvent ?? -Infinity) || a.number - b.number);
    const rows = el('teamRows');
    rows.replaceChildren();
    for (const team of teams) {
      const row = node('tr');
      row.dataset.teamId = team.id;
      const name = node('td', undefined, 'team-cell');
      name.append(node('strong', team.name), node('small', `#${team.number}`), evidenceDetails(team));
      const cost = node('td', undefined, 'num pollen-cost');
      cost.append(node('span', String(team.price), 'cost-badge'));
      cost.setAttribute('aria-label', `Cost: ${team.price} Pollen`);
      const points = node('td', undefined, 'num points');
      points.append(node('span', team.predictionPoints === null ? 'Unscored' : number(team.predictionPoints), team.predictionPoints === null ? 'score-note' : ''));
      const evidence = team.evidence ?? {};
      const trend = node('td', signed(evidence.trendOprPerEvent), 'num');
      if (Number.isFinite(evidence.trendOprPerEvent)) trend.classList.add(evidence.trendOprPerEvent > 0 ? 'trend-up' : evidence.trendOprPerEvent < 0 ? 'trend-down' : 'trend-flat');
      const pickCell = node('td'), pick = node('button', selected.has(team.id) ? '−' : '+', 'pick');
      pick.type = 'button';
      pick.setAttribute('aria-label', `${selected.has(team.id) ? 'Remove' : 'Add'} ${team.number} ${team.name}`);
      pick.setAttribute('aria-pressed', String(selected.has(team.id)));
      pick.disabled = !selected.has(team.id) && (!team.draftEligible || selected.size >= 3 || pollenUsed() + team.price > 15);
      if (!team.draftEligible) pick.title = 'This DECODE team is not eligible for the current draft.';
      else if (!selected.has(team.id) && pollenUsed() + team.price > 15) pick.title = `Costs ${team.price} Pollen; ${15 - pollenUsed()} remaining.`;
      else if (!selected.has(team.id) && selected.size >= 3) pick.title = 'Your roster already has three teams.';
      pick.onclick = () => selectTeam(team);
      pickCell.append(pick);
      row.append(node('td', team.rank === null ? '—' : String(team.rank), 'rank'), name, cost, points, node('td', number(evidence.lastOpr), 'num'), trend, pickCell);
      rows.append(row);
    }
    el('noTeams').hidden = teams.length !== 0;
    el('teamCaption').textContent = `${teams.length} of ${pool.length} ${currentDraft ? 'draftable teams' : 'teams with PP'} · PP per event on the DECODE scale`;
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
    el('loadStatus').textContent = data ? 'Refreshing prediction data…' : 'Loading PP…';
    try {
      const response = await fetch('/api/admin/predictions', {cache: 'no-store', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Owner sign-in is required. Sign in again to view predictions.' : 'Predictions could not be loaded. Use Refresh data to retry.');
      const result = await response.json();
      if (!Array.isArray(result.teams) || !Array.isArray(result.draftTeams) || !Array.isArray(result.rosters) || !result.model || !result.counts || !result.coverage) throw new Error('Prediction data was incomplete. Use Refresh data to retry.');
      data = result;
      for (const id of selected) if (!data.draftTeams.some(team => team.id === id && team.draftEligible)) { selected.delete(id); plannedEvents.delete(id); }
      el('scoredCount').textContent = String(data.counts.scored);
      el('poolCount').textContent = 'Expected OPR per event · DECODE scale';
      el('historyCount').textContent = String(data.coverage.historyTeams ?? 0);
      el('unscoredCount').textContent = String(data.coverage.unscoredDraftTeams);
      el('coverageNote').textContent = `Only current draft teams are listed. ${data.coverage.historyTeams ?? 0} have event histories, ${data.coverage.summaryOnlyTeams ?? 0} use a historical-average fallback, and ${data.coverage.unscoredDraftTeams} remain unscored. Open a team’s evidence to inspect its history. PP is a per-event estimate; event counts belong in your season scenario.`;
      el('methodNote').textContent = 'Model: ' + (data.model.label || data.model.method || 'Historical estimate');
      const methods = {
        historicalMean: 'PP is the arithmetic mean of earlier event OPRs.',
        lastEvent: 'PP uses the latest recorded event OPR.',
        priorPeak: 'PP uses the highest recorded event OPR.',
        currentV2: 'The historical comparison method combines average OPR with a capped peak contribution.',
        recentWeightedMean: 'Recent event OPRs receive weights 1, ½, ¼, and so on, starting with the latest event. PP is their weighted mean.',
        dampedTrend: 'PP = recent weighted mean + ½ × trend. The latest event gets weight 1, the previous event ½, then ¼, and so on. Trend is a fitted straight-line change in OPR per event. There is no peak bonus or 100 PP normalization.'
      };
      el('methodFormula').textContent = methods[data.model.method] || 'Event OPR estimates use the model identified above.';
      el('modelLimitation').textContent = data.model.limitation || 'Preseason estimates use DECODE’s scoring scale. They are not earned points or a validated numerical forecast for BioBuzz.';
      const validation = data.validation ?? {};
      const tested = ['validated', 'baseline_retained'].includes(validation.status) && validation.holdoutCount > 0;
      const error = validation.status === 'baseline_retained' ? validation.baselineMae : validation.candidateMae;
      el('validationError').textContent = tested && Number.isFinite(error) ? number(error) + ' OPR' : 'Not yet measured';
      el('validationSample').textContent = tested ? `${validation.holdoutCount} later-event predictions` : 'More historical evidence is needed';
      const comparison = tested && Number.isFinite(validation.baselineMae) && Number.isFinite(validation.candidateMae)
        ? `On ${validation.holdoutCount} later DECODE results, the candidate’s mean error was ${number(validation.candidateMae)} OPR versus ${number(validation.baselineMae)} for the historical average. ` : '';
      el('validationDetail').textContent = comparison + (validation.status === 'baseline_retained' ? 'The historical average is retained. ' : '') + (tested ? 'This small, championship-heavy test does not establish new-season accuracy.' : 'More historical evidence is needed to compare methods.');
      el('validationMethodNote').textContent = `The earlier ${validation.selectionCount ?? 0} predictions choose a candidate; later results check that choice. ` + (validation.limitation || 'No cross-season accuracy has been established.');
      el('sourceNote').textContent = data.source ? ` · ${data.source.eventCount} official DECODE events, including championships. Snapshot retrieved ${new Date(data.source.fetchedAt).toLocaleDateString()}. Qualification OPR excludes opponent penalties.` : ' · Historical DECODE records.';
      el('updatedAt').textContent = 'Loaded ' + new Date(data.generatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      el('modelVersion').textContent = 'Model ' + data.model.version;
      renderTeams(); renderCalculator(); renderRosters();
      el('loadStatus').hidden = true;
    } catch (error) {
      el('loadStatus').textContent = (error.name === 'TimeoutError' ? 'Loading timed out. Use Refresh data to retry.' : error.message) + (data ? ' Previously loaded results are still shown.' : '');
    } finally { loading = false; el('refresh').disabled = false; }
  }
  for (const id of ['teamSearch', 'teamScope', 'priceFilter', 'sortOrder', 'scoredOnly']) el(id).addEventListener(id === 'teamSearch' ? 'input' : 'change', renderTeams);
  for (const [buttonId, panelId] of [['teamTab', 'teamPanel'], ['rosterTab', 'rosterPanel']]) {
    el(buttonId).onclick = () => {
      for (const [button, panel] of [['teamTab', 'teamPanel'], ['rosterTab', 'rosterPanel']]) {
        el(button).setAttribute('aria-pressed', String(button === buttonId));
        el(panel).hidden = panel !== panelId;
      }
    };
  }
  el('clearRoster').onclick = () => { selected.clear(); plannedEvents.clear(); renderTeams(); renderCalculator(); };
  el('refresh').onclick = load;
  renderCalculator();
  load();
})();
