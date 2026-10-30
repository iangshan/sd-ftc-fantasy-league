import { readFileSync } from 'node:fs';
import { fixture, owner, FRC_LEAGUE } from '../../staging/tests/support/leagues-fixture.mjs';
import { TBA_ORIGIN } from '../../src/frc/tba.mjs';

export function matches(event = '2026casd', contributions = [110, 70, 50, 40, 30, 10], rounds = 8) {
  const teams = contributions.map((_, i) => i + 100);
  let seed = 7165;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const result = [];
  for (let round = 0; round < rounds; round++) {
    const order = [...teams];
    for (let i = order.length - 1; i > 0; i--) {
      const j = random() % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let offset = 0; offset < teams.length; offset += 6) {
      const row = {
        key: `${event}_qm${result.length + 1}`,
        event_key: event,
        comp_level: 'qm',
        alliances: {},
        score_breakdown: {},
      };
      for (const [color, start] of [
        ['red', offset],
        ['blue', offset + 3],
      ]) {
        const selected = order.slice(start, start + 3),
          foul = color === 'red' ? 20 : 5;
        const score = selected.reduce((sum, number) => sum + contributions[number - 100], 0) + foul;
        row.alliances[color] = { team_keys: selected.map((number) => `frc${number}`), score };
        row.score_breakdown[color] = { totalPoints: score, foulPoints: foul };
      }
      result.push(row);
    }
  }
  return result;
}
export function frcFixture() {
  const f = fixture();
  f.sql.exec(
    readFileSync(new URL('../../migrations/0006_frc_drafting.sql', import.meta.url), 'utf8'),
  );
  const responses = new Map(),
    calls = [];
  const teams = Array.from({ length: 6 }, (_, i) => ({
    key: `frc${100 + i}`,
    team_number: 100 + i,
    nickname: `TEST FRC Team ${100 + i}`,
  }));
  const historical = {
    key: '2026casd',
    year: 2026,
    name: 'TEST San Diego Regional',
    event_type: 0,
    start_date: '2026-03-20',
    end_date: '2026-03-22',
  };
  responses.set('/event/2026casd/simple', historical);
  responses.set('/event/2026casd/teams/simple', teams);
  responses.set('/event/2026casd/matches', matches());
  const fetcher = async (url, options) => {
    if (!url.startsWith(TBA_ORIGIN + '/event/') && !url.startsWith(TBA_ORIGIN + '/events/'))
      throw new Error('Unexpected external URL.');
    const path = url.slice(TBA_ORIGIN.length);
    calls.push({ path, headers: options.headers });
    const data = responses.get(path);
    if (data instanceof Response) return data.clone();
    return data === undefined ? Response.json({}, { status: 404 }) : Response.json(data);
  };
  const env = { DB: f.db, STAGING_FRC_ENABLED: 'true', TBA_AUTH_KEY: 'fixture-read-key' };
  const context = (person = owner) => f.context(person, FRC_LEAGUE);
  return { ...f, env, context, responses, calls, teams, fetcher };
}
