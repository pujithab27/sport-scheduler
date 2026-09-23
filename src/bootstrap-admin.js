import bcrypt from 'bcryptjs';
import { one, run } from './db.js';

export async function bootstrapAdmin() {
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || '').trim();
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!name && !email && !password) return;
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
    throw new Error('Set valid BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD (12+ characters).');
  }
  if (await one("SELECT id FROM users WHERE role='admin' LIMIT 1")) return;
  if (await one('SELECT id FROM users WHERE email=?', email)) throw new Error('Bootstrap admin email already belongs to a player account.');
  await run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', name, email, bcrypt.hashSync(password, 12), 'admin');
  console.log('Initial administrator created. Remove bootstrap admin variables from the hosting dashboard.');
}
