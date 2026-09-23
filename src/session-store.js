import session from 'express-session';
import { one, run } from './db.js';

export class DatabaseSessionStore extends session.Store {
  get(sid, callback) {
    one('SELECT sess, expires_at FROM login_sessions WHERE sid = ?', sid).then(row => {
      if (!row || row.expires_at <= Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    }).catch(callback);
  }
  set(sid, value, callback) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
    run('INSERT INTO login_sessions(sid,sess,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires_at=excluded.expires_at', sid, JSON.stringify(value), expires).then(() => callback?.()).catch(error => callback?.(error));
  }
  destroy(sid, callback) {
    run('DELETE FROM login_sessions WHERE sid = ?', sid).then(() => callback?.()).catch(error => callback?.(error));
  }
}
