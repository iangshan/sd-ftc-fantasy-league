import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';
import { frcFixture, matches } from './support/frc-fixture.mjs';
import { owner, FRC_LEAGUE } from '../staging/tests/support/leagues-fixture.mjs';
import {
  syncFrcLeague,
  frcSnapshot,
  frcAdminMutation,
  submitFrcRoster,
} from '../src/frc/service.mjs';

// The draft board, roster, and admin screens share one template, so every view
// renders against the same element ids. These checks drive the real browser
// script with a real API payload; they do not replace a sign-in by a person.
const page = readFileSync(new URL('../web/frc.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../web/frc.js', import.meta.url), 'utf8');
const ids = new Set([...page.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

const stub = (tag) => ({
  tag,
  children: [],
  textContent: '',
  value: '',
  dataset: {},
  append(...nodes) {
    this.children.push(...nodes);
  },
  replaceChildren(...nodes) {
    this.children = [...nodes];
  },
  setAttribute() {},
  querySelectorAll: () => [],
  reportValidity: () => true,
});

async function render(payload, pathname) {
  const nodes = new Map([...ids].map((id) => [id, stub(id)]));
  const missing = [];
  const context = createContext({
    location: { pathname },
    confirm: () => false,
    fetch: async () => ({ ok: true, json: async () => payload }),
    document: {
      getElementById: (id) => {
        if (!nodes.has(id)) missing.push(id);
        return nodes.get(id) ?? null;
      },
      createElement: (tag) => stub(tag),
    },
  });
  new Script(client).runInContext(context);
  await tick();
  const flatten = (node) =>
    [node.textContent, ...node.children.map(flatten)].filter(Boolean).join(' | ');
  return { text: (id) => flatten(nodes.get(id)), node: (id) => nodes.get(id), missing };
}

test('every FRC view renders the weight-class ranking from a real snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-30T00:00:00Z') });
  const f = frcFixture();
  t.after(f.close);
  const context = (person = owner) => f.context(person, FRC_LEAGUE);
  const admin = async (input) =>
    frcAdminMutation(
      f.db,
      f.env,
      await context(),
      { contextLeagueId: FRC_LEAGUE, ...input },
      f.fetcher,
    );
  await admin({
    action: 'configure',
    eventKey: '2027casd',
    historyEvents: ['2026casd'],
    scoringEvents: ['2027casd'],
  });
  f.responses.set('/event/2027casd/teams/simple', f.teams);
  f.responses.set('/event/2027casd/simple', {
    key: '2027casd',
    year: 2027,
    name: 'TEST counted event',
    event_type: 0,
    start_date: '2027-03-20',
    end_date: '2027-03-22',
  });
  f.responses.set('/event/2027casd/matches', []);
  await syncFrcLeague(f.db, f.env, FRC_LEAGUE, owner.uid, f.fetcher);
  await admin({ action: 'setOpen', open: true });
  const save = async (teamNumbers, person) =>
    submitFrcRoster(f.db, await context(person), {
      contextLeagueId: FRC_LEAGUE,
      season: 2027,
      catalogVersion: (await frcSnapshot(f.db, f.env, await context(person))).catalogVersion,
      displayName: person ? 'TEST Stacker' : 'TEST Owner',
      teamNumbers,
    });
  await save([100, 103]);
  const stacker = f.member('frc-stacker', FRC_LEAGUE);
  await save([104, 105, 102], stacker);

  // Before any counted event, no view may invent a score.
  for (const [view, pathname] of [
    ['draft', '/'],
    ['roster', '/dashboard'],
    ['admin', '/admin'],
  ]) {
    const pending = await render(await frcSnapshot(f.db, f.env, await context()), pathname);
    assert.deepEqual(pending.missing, [], `${view} requested an element the template lacks`);
    assert.match(pending.text('frcClassNote'), /Weight classes: Light 3 Pollen \(2 teams\)/);
    assert.match(pending.text('frcClassNote'), /Drafting is unrestricted/);
    if (view === 'roster') {
      assert.match(pending.text('frcSavedRoster'), /2027 earned points start after/);
      assert.match(pending.text('frcStandings'), /points will appear after a counted event/);
    }
  }

  t.mock.timers.setTime(new Date('2027-03-24T00:00:00Z').getTime());
  f.responses.set('/event/2027casd/matches', matches('2027casd', [230, 160, 120, 110, 70, 30]));
  await syncFrcLeague(f.db, f.env, FRC_LEAGUE, owner.uid, f.fetcher);

  const board = await render(await frcSnapshot(f.db, f.env, await context()), '/');
  assert.deepEqual(board.missing, []);
  assert.equal(board.node('frcTeams').children.length, 6);
  assert.match(board.text('frcTeams'), /Heavy class · 7–11 Pollen · 2 teams/);
  assert.match(board.text('frcTeams'), /Light class · 3 Pollen · 2 teams/);
  assert.match(board.text('frcTeams'), /Class points · class leader \| 100\.0 \/ 100/);
  assert.match(board.text('frcTeams'), /2027 earned OPR \| 230\.0/);

  // The stacked roster holds Light with team 104 and ranks team 105 in Heavy.
  const mine = await render(await frcSnapshot(f.db, f.env, await context(stacker)), '/dashboard');
  assert.deepEqual(mine.missing, []);
  const roster = mine.text('frcSavedRoster');
  assert.match(roster, /#104 TEST FRC Team 104 · 3 Pollen \| Light class \| 100\.0 \/ 100 class/);
  assert.match(roster, /#105 .* \| Light class drafted twice · ranked in the Heavy class \| 13\.0/);
  assert.match(roster, /11 \/ 15 Pollen/);
  assert.match(roster, /2027 earned points: 213\.0 \/ 300/);
  assert.match(roster, /Receipt [0-9a-f-]{36}/);
  assert.match(mine.text('frcStandings'), /1\. TEST Stacker \(you\) \| 213\.0 \/ 300/);
  assert.match(mine.text('frcStandings'), /2\. TEST Owner \| 191\.7 \/ 300/);
});
