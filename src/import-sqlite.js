import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { all, transaction } from './db.js';

const sourcePath = process.argv[2] || 'data/scheduler.sqlite';
if (!existsSync(sourcePath)) throw new Error(`SQLite source file not found: ${sourcePath}`);
for (const table of ['users', 'sports', 'sessions', 'initial_players', 'participants']) {
  if ((await all(`SELECT id FROM ${table} LIMIT 1`)).length) throw new Error('Destination database already has app data. Import into an empty database to avoid duplicates.');
}

const source = new DatabaseSync(sourcePath, { readOnly: true });
const tables = {
  users: ['id', 'name', 'email', 'password_hash', 'role', 'created_at'],
  sports: ['id', 'name', 'creator_id', 'created_at'],
  sessions: ['id', 'sport_id', 'creator_id', 'starts_at', 'venue', 'extra_capacity', 'cancelled_at', 'cancellation_reason', 'created_at'],
  initial_players: ['id', 'session_id', 'team', 'name'],
  participants: ['id', 'session_id', 'user_id', 'team', 'joined_at']
};
try {
  await transaction(async db => {
    for (const [table, columns] of Object.entries(tables)) {
      const rows = source.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all();
      const placeholders = columns.map(() => '?').join(',');
      for (const row of rows) await db.run(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${placeholders})`, ...columns.map(column => row[column]));
      await db.run(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1), EXISTS(SELECT 1 FROM ${table}))`);
      console.log(`${table}: ${rows.length} imported`);
    }
  });
} finally { source.close(); }
console.log('Import complete. Login sessions were not copied; sign in again.');
