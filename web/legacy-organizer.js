let data = null,
  busy = false;
const $ = (id) => document.getElementById(id);
function notice(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}
async function api(options) {
  const response = await fetch('/api/organizer', { cache: 'no-store', ...options });
  if (response.status === 401) throw new Error('Organizer sign-in is required. Reload the page.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Please try again.');
  return result;
}
function cell(value) {
  const td = document.createElement('td');
  td.textContent = value;
  return td;
}
function render() {
  if (!data) return;
  $('status').textContent = !data.connected
    ? 'Not connected'
    : !data.enabled
      ? 'Setup pending'
      : data.open
        ? 'Open'
        : 'Closed';
  $('statusDetail').textContent = !data.connected
    ? 'Connect the response workbook to accept entries.'
    : !data.enabled
      ? 'Google Sheets is connected. Submission activation is still pending.'
      : data.open
        ? 'Participants can submit their picks.'
        : 'The team list is visible; submissions are closed.';
  $('count').textContent = data.connected ? data.entries.length : '—';
  $('connection').hidden = data.connected;
  $('toggle').disabled = busy || !data.connected || !data.enabled;
  $('toggle').textContent = data.open ? 'Close draft' : 'Open draft';
  $('sheet').hidden = !data.workbookUrl;
  if (data.workbookUrl) $('sheet').href = data.workbookUrl;
  $('recovery').hidden = !data.pending;
  $('recover').disabled = busy || !data.pending?.canRecover;
  $('entries').replaceChildren();
  data.entries.forEach((e) => {
    const tr = document.createElement('tr');
    tr.append(
      cell(e.playerName),
      cell(e.playerTeamName),
      cell(e.discordId),
      cell(e.teams.map((t) => '#' + t.number + ' ' + t.name).join(' · ')),
      cell(e.total + ' pollen'),
      cell(new Date(e.submittedAt).toLocaleString()),
    );
    $('entries').append(tr);
  });
  $('empty').hidden = data.entries.length > 0;
  $('empty').textContent = data.connected
    ? 'No entries yet.'
    : 'Entries will appear after Google Sheets is connected.';
}
async function load() {
  try {
    data = await api();
    render();
  } catch (e) {
    notice(e.message);
    $('status').textContent = 'Unavailable';
  }
}
async function act(payload) {
  busy = true;
  render();
  notice('');
  try {
    await api({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await load();
  } catch (e) {
    notice(e.message);
  } finally {
    busy = false;
    render();
  }
}
$('toggle').addEventListener('click', () => act({ action: 'setOpen', open: !data.open }));
$('recover').addEventListener('click', () => act({ action: 'recover' }));
$('refresh').addEventListener('click', () => {
  notice('');
  load();
});
load();
