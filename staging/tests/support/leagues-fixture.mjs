import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { LEAGUE_OWNER_UID } from '../../../dist/staging-app.mjs';
import { FTC_LEAGUE, leagueContext, leagueMutation } from '../../leagues.mjs';

export const FRC_LEAGUE = 'san-diego-frc';
export const origin = 'https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev';
export const user = (uid, extra = {}) => ({
  uid,
  email: `${uid}@example.invalid`,
  displayName: `Test ${uid}`,
  emailVerified: true,
  signInProvider: 'google.com',
  ...extra,
});
export const owner = user(LEAGUE_OWNER_UID);
export function request(
  path = '/',
  { league = FTC_LEAGUE, body, method = body ? 'POST' : 'GET', headers = {} } = {},
) {
  return new Request(origin + path, {
    method,
    headers: {
      Cookie: `__Host-ftc-staging=fixture.token; __Host-fantasy-league=${league}`,
      ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export const leagueMigration = readFileSync(
  new URL('../../migrations/0001_leagues.sql', import.meta.url),
  'utf8',
);
export function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON;');
  sql.exec(
    readFileSync(new URL('../../../migrations/0003_admin_dashboard.sql', import.meta.url), 'utf8'),
  );
  sql.exec(
    readFileSync(
      new URL('../../../migrations/0004_account_rosters_schema.sql', import.meta.url),
      'utf8',
    ),
  );
  sql.exec(leagueMigration);
  function prepare(query, args = []) {
    const statement = sql.prepare(query);
    return {
      bind: (...values) => prepare(query, values),
      run: async () => ({
        success: true,
        meta: { changes: Number(statement.run(...args).changes) },
      }),
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ success: true, results: statement.all(...args) }),
    };
  }
  const db = {
    prepare,
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  function member(uid, league = FTC_LEAGUE, role = 'player', active = 1) {
    const person = user(uid);
    sql
      .prepare(
        'INSERT INTO fantasy_memberships (uid,league_id,role,active,email,display_name,joined_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(uid, league, role, active, person.email, person.displayName, new Date().toISOString());
    if (league === FTC_LEAGUE && role === 'admin' && active)
      sql
        .prepare('INSERT INTO league_admins VALUES (?,?,?)')
        .run(uid, LEAGUE_OWNER_UID, new Date().toISOString());
    return person;
  }
  const context = (person = owner, league = FTC_LEAGUE) =>
    leagueContext(db, person, LEAGUE_OWNER_UID, request('/', { league }));
  const mutate = async (input, person = owner, league = FTC_LEAGUE) =>
    leagueMutation(
      db,
      await context(person, league),
      { contextLeagueId: league, ...input },
      LEAGUE_OWNER_UID,
    );
  return { sql, db, member, context, mutate, close: () => sql.close() };
}
