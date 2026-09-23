import bcrypt from 'bcryptjs';
import { one, run } from './db.js';

const [name, email] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!name || !email || !password || password.length < 12) {
  console.error('Usage: ADMIN_PASSWORD=<strong-password> node src/setup-admin.js "Name" email@example.com');
  process.exit(1);
}
const normalized = email.trim().toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(normalized) || await one('SELECT id FROM users WHERE email = ?', normalized)) {
  console.error('Invalid email or account already exists.');
  process.exit(1);
}
await run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', name.trim(), normalized, bcrypt.hashSync(password, 12), 'admin');
console.log(`Administrator created: ${normalized}`);
