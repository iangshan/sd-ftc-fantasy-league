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
  let data = null, draft = null, loading = false, submitting = false;
  const makeToken = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(24))].map(value => value.toString(16).padStart(2, '0')).join('');
  let savedReceipt = null, uncertainSave = false, accountIssue = '', previousUid;
  let accountEpoch = 0, submissionToken = makeToken();
  const selected = new Set();
  const plannedEvents = new Map();
  const detailFields = ['playerName', 'playerTeamName', 'discordId'];
  const pickedTeams = () => data ? [...selected].map(id => data.draftTeams.find(team => team.id === id)).filter(Boolean) : [];
  const pollenUsed = () => pickedTeams().reduce((sum, team) => sum + team.price, 0);
  const account = () => window.leagueAccount;
  const locked = () => submitting || savedReceipt !== null || uncertainSave || Boolean(account()?.data?.roster || account()?.data?.pending);
  const announce = message => { el('liveAnnouncement').textContent = message; };
  function formMessage(message = '') {
    el('formMessage').textContent = message;
    el('formMessage').hidden = !message;
  }

  function normalizeDraft(value) {
    if (!value || !Array.isArray(value.catalog) || value.budget !== 15 || value.maxTeams !== 3 || typeof value.open !== 'boolean' || typeof value.preview !== 'boolean') throw new Error('The draft settings are unavailable. Submissions are paused; use Refresh data to retry.');
    if (!value.preview && !/^v1-[a-f0-9]{24}$/.test(value.priceVersion)) throw new Error('The current price version could not be verified. Use Refresh data before submitting.');
    const seen = new Set(), catalog = [];
    for (const entry of value.catalog) {
      const id = String(entry.id ?? entry.number);
      if (!/^[1-9][0-9]{0,8}$/.test(id) || seen.has(id) || Number(entry.number) !== Number(id) || typeof entry.name !== 'string' || !entry.name.trim()) throw new Error('The team catalog needs an organizer update. Submissions are paused.');
      seen.add(id);
      if (entry.available === false) continue;
      if (!Number.isInteger(entry.price) || ![3, 4, 5, 6, 11].includes(entry.price)) throw new Error('A team has an invalid Pollen price. Submissions are paused.');
      catalog.push({...entry, id, number: Number(id), available: true});
    }
    return {catalog, budget: value.budget, maxTeams: value.maxTeams, open: value.open, preview: value.preview, priceVersion: String(value.priceVersion ?? '')};
  }

  function mergePredictions(currentDraft, predictions) {
    if (predictions && (!Array.isArray(predictions.draftTeams) || !Array.isArray(predictions.rosters) || !predictions.model)) throw new Error('Prediction data was incomplete.');
    const forecasts = new Map();
    for (const team of predictions?.draftTeams ?? []) {
      if (forecasts.has(String(team.id)) || team.predictionPoints !== null && !Number.isFinite(team.predictionPoints)) throw new Error('Prediction data was incomplete.');
      forecasts.set(String(team.id), team);
    }
    const teams = currentDraft.catalog.map(team => {
      const forecast = forecasts.get(team.id), points = forecast?.predictionPoints ?? null;
      return {
        ...forecast, ...team, draftEligible: true, predictionPoints: points,
        averageOpr: forecast?.averageOpr ?? team.averageOpr ?? null,
        highestOpr: forecast?.highestOpr ?? team.highestOpr ?? null,
        pointsPerPollen: points === null ? null : Math.round(points / team.price * 100) / 100,
        evidence: forecast?.evidence ?? {source: 'none'}, rank: null
      };
    }).sort((a, b) => (b.predictionPoints ?? -Infinity) - (a.predictionPoints ?? -Infinity) || a.number - b.number);
    let previousPoints, rank;
    teams.forEach((team, index) => {
      if (team.predictionPoints === null) return;
      if (previousPoints !== team.predictionPoints) rank = index + 1;
      team.rank = rank; previousPoints = team.predictionPoints;
    });
    const scored = teams.filter(team => team.predictionPoints !== null);
    return {
      ...(predictions ?? {}), draftTeams: teams, teams: scored,
      model: predictions?.model ?? {version: 'unavailable', method: 'unavailable', label: 'Predictions unavailable', limitation: 'PP could not be loaded. You may still draft eligible teams at their listed Pollen prices.'},
      counts: {total: scored.length, scored: scored.length, unscored: 0},
      coverage: {...predictions?.coverage, draftTeams: teams.length, historyTeams: teams.filter(team => team.evidence.source === 'event_history').length, summaryOnlyTeams: teams.filter(team => team.evidence.source === 'summary_only').length, unscoredDraftTeams: teams.length - scored.length},
      rosters: predictions?.rosters ?? [], rosterStatus: predictions?.rosterStatus ?? 'unavailable',
      generatedAt: predictions?.generatedAt ?? new Date().toISOString()
    };
  }

  function updateSubmission() {
    const session = account(), current = session?.data, fieldsReady = detailFields.every(id => el(id).value.trim());
    let text;
    if (submitting) text = 'Saving your roster…';
    else if (savedReceipt || current?.roster) text = 'Roster already submitted';
    else if (uncertainSave || current?.pending) text = 'Check your save in My dashboard';
    else if (!session?.ready) text = 'Checking your account…';
    else if (!session.user) text = 'Sign in to submit';
    else if (!session.user.emailVerified) text = 'Verify your email to submit';
    else if (session.error || accountIssue || !current) text = 'Refresh your account to submit';
    else if (loading || !draft) text = 'Loading current draft settings…';
    else if (draft.preview) text = 'Preview only · submissions disabled';
    else if (!draft.open || current.submissionsEnabled !== true) text = 'Draft closed';
    else if (!selected.size) text = 'Choose your teams to continue';
    else if (!fieldsReady) text = 'Add your details to submit';
    else if (selected.size > draft.maxTeams || pollenUsed() > draft.budget) text = 'Review your roster budget';
    else text = `Submit roster · ${pollenUsed()} Pollen`;
    el('submitDraft').textContent = text;
    el('submitDraft').disabled = !text.startsWith('Submit roster ·');
    const unavailable = submitting || savedReceipt !== null || Boolean(current?.roster) || uncertainSave || Boolean(current?.pending);
    for (const id of detailFields) el(id).disabled = unavailable || Boolean(draft?.preview);
    const gate = el('accountGate'); gate.replaceChildren();
    let gateMessage;
    if (savedReceipt || current?.roster) gateMessage = 'Your account already has a saved roster for this season.';
    else if (uncertainSave || current?.pending) gateMessage = 'Check the status of your previous save before submitting again.';
    else if (!session?.ready) gateMessage = 'Checking your league account…';
    else if (!session.user) gateMessage = 'Sign in with your league account to save your roster.';
    else if (!session.user.emailVerified) gateMessage = 'Verify your email in My dashboard before submitting.';
    else if (session.error || accountIssue || !current) gateMessage = accountIssue || session.error || 'Loading your account details…';
    else gateMessage = 'Signed in. You can submit one roster for this season.';
    gate.append(node('p', gateMessage));
    const dashboard = node('a', session?.user ? 'Open My dashboard' : 'Sign in in My dashboard'); dashboard.href = '/dashboard'; gate.append(dashboard);
    el('submissionRecovery').hidden = !(uncertainSave || current?.pending || accountIssue);
    el('refresh').disabled = loading || submitting;
  }

  function selectTeam(team) {
    if (locked() || loading || !draft || !draft.open) return;
    if (selected.has(team.id)) selected.delete(team.id);
    else if (team.draftEligible && selected.size < 3 && pollenUsed() + team.price <= 15) selected.add(team.id);
    renderTeams();
    renderCalculator();
    updateSubmission();
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
        remove.disabled = locked() || loading || !draft?.open;
        remove.onclick = () => selectTeam(team);
        const plan = node('label', undefined, 'event-plan');
        plan.append(node('span', 'Scenario events (optional)'));
        const input = node('input');
        input.type = 'number'; input.min = '0'; input.max = '12'; input.step = '1';
        input.inputMode = 'numeric'; input.placeholder = '—';
        input.value = plannedEvents.get(team.id) ?? '';
        input.dataset.plannedTeamId = team.id;
        input.setAttribute('aria-label', `Planned events for ${team.number} ${team.name}`);
        input.disabled = locked() || loading;
        input.addEventListener('input', () => { plannedEvents.set(team.id, input.value); renderScenario(); });
        plan.append(input);
        row.append(info, remove, plan);
      } else row.append(node('span', 'Choose a team', 'subtle'));
      list.append(row);
    }
    el('pollenUsed').textContent = String(pollenUsed());
    el('pollenRemaining').textContent = String(15 - pollenUsed());
    el('mobileRosterSummary').textContent = `${teams.length} team${teams.length === 1 ? '' : 's'} · ${15 - pollenUsed()} Pollen left`;
    const missing = teams.filter(team => team.predictionPoints === null).length;
    const points = teams.reduce((sum, team) => sum + (team.predictionPoints ?? 0), 0);
    el('rosterPoints').textContent = !teams.length || missing ? '—' : number(points);
    el('projectionLabel').textContent = missing ? 'Prediction incomplete' : 'Roster PP per event';
    el('projectionNote').textContent = !teams.length ? 'Select a team to start.' : missing ? `${missing} team${missing === 1 ? ' has' : 's have'} no PP estimate. Known subtotal: ${number(points)} PP. Unscored teams can still be drafted.` : 'One event per selected team, on the DECODE scale. PP does not change your Pollen cost.';
    el('clearRoster').disabled = !selected.size || locked() || loading;
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
      pick.disabled = locked() || loading || !draft?.open || !selected.has(team.id) && (!team.draftEligible || selected.size >= 3 || pollenUsed() + team.price > 15);
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
    el('rosterStatus').textContent = unavailable ? 'Saved test rosters could not be loaded. You can still browse the team list. Use Refresh data to retry.' : '';
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
  function renderMetadata() {
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
  }

  async function readJson(path) {
    const response = await fetch(path, {cache: 'no-store', signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Sign in again to access this private site.' : 'The requested data could not be loaded. Use Refresh data to retry.');
    return response.json();
  }

  function receiptIsValid(value) {
    return value?.ok === true && typeof value.receiptId === 'string' && value.receiptId.length > 0 && value.receiptId.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.receiptId)
      && Number.isInteger(value.total) && value.total > 0 && value.total <= 15 && value.remaining === 15 - value.total
      && Array.isArray(value.teamIds) && value.teamIds.length >= 1 && value.teamIds.length <= 3
      && value.teamIds.every(id => /^[1-9][0-9]{0,8}$/.test(String(id))) && new Set(value.teamIds.map(String)).size === value.teamIds.length
      && typeof value.priceVersion === 'string' && /^v1-[a-f0-9]{24}$/.test(value.priceVersion);
  }

  function showReceipt(receipt, roster, moveFocus = false) {
    if (!receiptIsValid(receipt)) return false;
    savedReceipt = {...receipt, teamIds: receipt.teamIds.map(String)};
    uncertainSave = false; accountIssue = '';
    selected.clear(); plannedEvents.clear();
    for (const id of savedReceipt.teamIds) if (data?.draftTeams.some(team => team.id === id)) selected.add(id);
    const rows = el('successRoster'); rows.replaceChildren();
    const names = new Map([...(data?.draftTeams ?? []), ...(roster?.teams ?? [])].map(team => [String(team.id ?? team.number), team]));
    for (const id of savedReceipt.teamIds) {
      const team = names.get(id), item = node('li');
      item.append(node('span', `#${id} · ${team?.name || 'Saved team'}`));
      rows.append(item);
    }
    el('receiptId').textContent = savedReceipt.receiptId;
    el('successTotal').textContent = `${savedReceipt.total} / 15 Pollen`;
    el('successPanel').hidden = false; el('draftForm').hidden = true;
    detailFields.forEach(id => { el(id).value = ''; });
    formMessage();
    renderTeams(); renderCalculator(); updateSubmission();
    if (moveFocus) {
      el('successPanel').focus();
      el('successPanel').scrollIntoView({behavior: 'smooth', block: 'nearest'});
      announce('Your saved roster is confirmed. The receipt shows the teams recorded for your account.');
    }
    return true;
  }

  async function refreshAccount(releaseUncertain = false) {
    const session = account(), uid = session?.user?.uid, epoch = accountEpoch;
    if (!uid || !session.user.emailVerified || typeof session.api !== 'function') return false;
    try {
      const result = await session.api('/api/account', {signal: AbortSignal.timeout(20000)});
      if (account()?.user?.uid !== uid || epoch !== accountEpoch) return false;
      if (!result || result.user?.uid !== uid || typeof result.submissionsEnabled !== 'boolean' || typeof result.pending !== 'boolean') throw new Error('Account status was incomplete. Open My dashboard to verify your save.');
      session.data = result; session.error = null; accountIssue = '';
      if (result.roster) {
        if (!showReceipt(result.roster.receipt, result.roster)) throw new Error('Your account has a saved roster. Open My dashboard to inspect its receipt.');
      } else if (releaseUncertain && !result.pending) {
        uncertainSave = false;
        if (savedReceipt) {
          savedReceipt = null; selected.clear(); plannedEvents.clear();
          el('successPanel').hidden = true; el('draftForm').hidden = false;
        }
      }
      document.dispatchEvent(new CustomEvent('league-account-change'));
      return true;
    } catch (error) {
      if (account()?.user?.uid === uid && epoch === accountEpoch) accountIssue = error.name === 'TimeoutError' ? 'Account status timed out. Open My dashboard before submitting.' : error.message || 'Account status could not be refreshed. Open My dashboard before submitting.';
      return false;
    }
  }

  async function load(reconcileAccount = false) {
    if (loading || submitting) return;
    const previousPrices = new Map(pickedTeams().map(team => [team.id, team.price]));
    loading = true; draft = null;
    el('loadStatus').hidden = false; el('loadStatus').textContent = data ? 'Refreshing team availability and PP…' : 'Loading teams and PP…';
    updateSubmission(); renderTeams(); renderCalculator();
    try {
      const [draftResult, predictionResult] = await Promise.allSettled([readJson('/api/draft'), readJson('/api/admin/predictions')]);
      if (draftResult.status !== 'fulfilled') throw draftResult.reason;
      draft = normalizeDraft(draftResult.value);
      let predictionWarning = '';
      try {
        if (predictionResult.status !== 'fulfilled') throw predictionResult.reason;
        data = mergePredictions(draft, predictionResult.value);
      } catch {
        data = mergePredictions(draft, null);
        predictionWarning = 'PP is temporarily unavailable. All eligible teams remain available to draft at their listed Pollen prices.';
        el('teamScope').value = 'draft';
        el('scoredOnly').checked = false;
      }
      const removed = [];
      for (const id of selected) if (!data.draftTeams.some(team => team.id === id)) { selected.delete(id); plannedEvents.delete(id); removed.push(id); }
      if (removed.length && !savedReceipt) formMessage('Some selections are no longer available and were removed. Review your roster before submitting.');
      else if (!savedReceipt && pickedTeams().some(team => previousPrices.has(team.id) && previousPrices.get(team.id) !== team.price)) formMessage('Selected team prices changed. Review your Pollen costs before submitting.');
      if (reconcileAccount) {
        const wasUncertain = uncertainSave;
        const refreshed = await refreshAccount(true);
        if (wasUncertain && refreshed && !uncertainSave && !savedReceipt && !account()?.data?.pending) formMessage('No saved roster or pending save was found. Review your picks and submit again when ready.');
      }
      if (savedReceipt) showReceipt(savedReceipt, account()?.data?.roster);
      renderMetadata();
      el('loadStatus').hidden = !predictionWarning;
      el('loadStatus').textContent = predictionWarning;
      el('draftStatus').hidden = draft.open && !draft.preview;
      el('draftStatus').textContent = draft.preview ? 'Preview mode: roster submissions are disabled until the league connection is available.' : draft.open ? '' : 'The draft is closed. You can browse predictions, but roster submissions are paused.';
    } catch (error) {
      draft = null;
      el('loadStatus').hidden = false;
      el('loadStatus').textContent = (error.name === 'TimeoutError' ? 'Loading timed out. Use Refresh data to retry.' : error.message) + (data ? ' Previously loaded predictions remain visible.' : '');
      el('draftStatus').hidden = false; el('draftStatus').textContent = 'Current draft availability could not be verified. Roster submissions are paused.';
    } finally {
      loading = false;
      renderTeams(); renderCalculator(); if (data) renderRosters(); updateSubmission();
    }
  }

  async function submitRoster(event) {
    event.preventDefault(); updateSubmission();
    if (el('submitDraft').disabled || !el('draftForm').reportValidity()) return;
    const session = account(), uid = session?.user?.uid, epoch = accountEpoch;
    const teams = pickedTeams();
    if (!uid || !draft || teams.length !== selected.size || teams.length < 1 || teams.length > draft.maxTeams || pollenUsed() > draft.budget) return;
    const payload = {
      playerName: el('playerName').value.trim(), playerTeamName: el('playerTeamName').value.trim(), discordId: el('discordId').value.trim(),
      teamIds: teams.map(team => team.id), priceVersion: draft.priceVersion, submissionToken
    };
    if ([payload.playerName, payload.playerTeamName, payload.discordId].some(value => /[\u0000-\u001f\u007f]/.test(value))) {
      formMessage('Remove line breaks or hidden control characters from your details.'); return;
    }
    submitting = true; formMessage(); renderTeams(); renderCalculator(); updateSubmission();
    try {
      const result = await session.api('/api/submit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)});
      if (account()?.user?.uid !== uid || epoch !== accountEpoch) return;
      if (!receiptIsValid(result)) throw new Error('The save response did not include a valid receipt. Check My dashboard before trying again.');
      submitting = false;
      // The backend may return an already-saved account receipt. Always show its
      // actual team IDs and total rather than claiming the attempted picks saved.
      showReceipt(result, null, true);
      await refreshAccount();
      if (account()?.user?.uid === uid && epoch === accountEpoch) await load();
    } catch (error) {
      if (account()?.user?.uid !== uid || epoch !== accountEpoch) return;
      submitting = false; uncertainSave = true;
      formMessage((error.name === 'TimeoutError' ? 'The save timed out before confirmation.' : error.message || 'Your save could not be confirmed.') + ' Check My dashboard, or use Refresh data to verify the save status before trying again.');
      await refreshAccount();
      if (savedReceipt) showReceipt(savedReceipt, account()?.data?.roster, true);
      else announce('The save is not confirmed. Your selections are preserved; check My dashboard.');
    } finally {
      if (account()?.user?.uid === uid && epoch === accountEpoch) {
        submitting = false; renderTeams(); renderCalculator(); updateSubmission();
      }
    }
  }

  function accountChanged() {
    const session = account(), uid = session?.user?.uid ?? null;
    if (previousUid !== uid) {
      accountEpoch++;
      if (previousUid !== undefined && previousUid !== null) {
        submitting = false; savedReceipt = null; uncertainSave = false; accountIssue = '';
        selected.clear(); plannedEvents.clear(); detailFields.forEach(id => { el(id).value = ''; });
        submissionToken = makeToken();
        el('successPanel').hidden = true; el('draftForm').hidden = false; formMessage();
      }
      previousUid = uid;
    }
    if (session?.data?.roster && !submitting) showReceipt(session.data.roster.receipt, session.data.roster);
    renderTeams(); renderCalculator(); updateSubmission();
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
  el('clearRoster').onclick = () => { if (locked() || loading) return; selected.clear(); plannedEvents.clear(); renderTeams(); renderCalculator(); updateSubmission(); };
  el('refresh').onclick = () => load(true);
  el('draftForm').addEventListener('submit', submitRoster);
  for (const id of detailFields) el(id).addEventListener('input', updateSubmission);
  document.addEventListener('league-account-change', accountChanged);
  accountChanged();
  load();
})();
