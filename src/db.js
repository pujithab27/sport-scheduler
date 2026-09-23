import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('player','admin')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE TABLE IF NOT EXISTS sports (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, creator_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS sports_name_unique ON sports (lower(name));
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY, sport_id INTEGER NOT NULL REFERENCES sports(id),
  creator_id INTEGER NOT NULL REFERENCES users(id), starts_at TEXT NOT NULL,
  venue TEXT NOT NULL, extra_capacity INTEGER NOT NULL CHECK(extra_capacity >= 0),
  cancelled_at TEXT, cancellation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE TABLE IF NOT EXISTS initial_players (
  id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id),
  team INTEGER NOT NULL CHECK(team IN (1,2)), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id),
  user_id INTEGER NOT NULL REFERENCES users(id), team INTEGER NOT NULL CHECK(team IN (1,2)),
  joined_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text), UNIQUE(session_id,user_id)
);
CREATE TABLE IF NOT EXISTS login_sessions (
  sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(starts_at);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
`;

const hosted = Boolean(process.env.DATABASE_URL);
let engine;
if (hosted) {
  engine = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000 });
  engine.on('error', error => console.error('Database connection error:', error));
} else {
  const path = process.env.DB_PATH || 'data/pglite';
  if (path !== 'memory://') mkdirSync(dirname(path), { recursive: true });
  engine = new PGlite(path);
}

export const ready = (async () => {
  if (hosted) await engine.query(schema);
  else await engine.exec(schema);
})();
await ready;

function placeholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}
function adapter(client) {
  const query = (sql, params) => client.query(placeholders(sql), params);
  return {
    one: async (sql, ...params) => (await query(sql, params)).rows[0] || null,
    all: async (sql, ...params) => (await query(sql, params)).rows,
    run: async (sql, ...params) => {
      const result = await query(sql, params);
      return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
    }
  };
}

const main = adapter(engine);
export const { one, all, run } = main;

export async function transaction(fn) {
  if (!hosted) return engine.transaction(tx => fn(adapter(tx)));
  const client = await engine.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(adapter(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  await engine.close?.();
  await engine.end?.();
}
