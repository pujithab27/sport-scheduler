import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = 'memory://';
process.env.SESSION_SECRET = 'test-secret-123456789012345678901234567890';
const { app } = await import('../src/app.js');
const { run, one, closeDatabase } = await import('../src/db.js');
const { bootstrapAdmin } = await import('../src/bootstrap-admin.js');

function client(base) {
  let cookie = '';
  return async (path, { method = 'GET', data } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (data) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(data); }
    const response = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, location: response.headers.get('location'), html: await response.text() };
  };
}
function token(html) { return html.match(/name="_csrf" value="([^"]+)"/)?.[1]; }

test('account, sport, session, join, cancellation and report workflow', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    process.env.BOOTSTRAP_ADMIN_NAME = 'Admin';
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'administrator-pass';
    await bootstrapAdmin();
    await bootstrapAdmin();
    delete process.env.BOOTSTRAP_ADMIN_NAME;
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    assert.equal(Number((await one("SELECT COUNT(*) AS count FROM users WHERE role='admin'")).count), 1);
    const admin = client(base), player = client(base), another = client(base);

    let page = await admin('/login');
    let response = await admin('/login', { method: 'POST', data: { _csrf: token(page.html), email: 'admin@example.com', password: 'administrator-pass' } });
    assert.equal(response.status, 302);
    page = await admin('/sports');
    assert.equal(page.status, 200);
    response = await admin('/sports', { method: 'POST', data: { _csrf: token(page.html), name: 'Football' } });
    assert.equal(response.status, 302);
    assert.equal((await one('SELECT name FROM sports')).name, 'Football');

    page = await player('/signup');
    response = await player('/signup', { method: 'POST', data: { _csrf: token(page.html), name: 'Player One', email: 'one@example.com', password: 'password-12345' } });
    assert.equal(response.status, 302);
    assert.equal((await player('/sports')).status, 403);
    assert.equal((await player('/admin/reports')).status, 403);
    page = await player('/sessions/new');
    assert.equal(page.status, 200);
    const future = new Date(Date.now() + 86400000 * 3);
    const local = future.toISOString().slice(0, 16);
    response = await player('/sessions', { method: 'POST', data: { _csrf: token(page.html), sport_id: '1', starts_at: local, timezone_offset: '0', venue: 'City Ground', extra_capacity: '1', team1: 'Initial One', team2: 'Initial Two' } });
    assert.equal(response.status, 302);
    const id = Number(response.location.split('/').pop());
    assert.ok(id > 0);

    page = await another('/signup');
    response = await another('/signup', { method: 'POST', data: { _csrf: token(page.html), name: 'Player Two', email: 'two@example.com', password: 'password-12345' } });
    assert.equal(response.status, 302);
    page = await another(`/sessions/${id}`);
    response = await another(`/sessions/${id}/join`, { method: 'POST', data: { _csrf: token(page.html), team: '2' } });
    assert.equal(response.status, 302);
    assert.equal(Number((await one('SELECT COUNT(*) AS count FROM participants WHERE session_id=?', id)).count), 1);
    response = await another(`/sessions/${id}/join`, { method: 'POST', data: { _csrf: token(page.html), team: '2' } });
    assert.equal(response.status, 400);
    response = await another(`/sessions/${id}/cancel`, { method: 'POST', data: { _csrf: token(page.html), reason: 'Not my session' } });
    assert.equal(response.status, 403);
    page = await another('/sessions');
    assert.match(page.html, /Joined by me/);

    page = await player(`/sessions/${id}`);
    response = await player(`/sessions/${id}/cancel`, { method: 'POST', data: { _csrf: token(page.html), reason: 'Ground unavailable' } });
    assert.equal(response.status, 302);
    assert.match((await another(`/sessions/${id}`)).html, /Ground unavailable/);
    assert.equal((await admin('/admin/reports?from=2020-01-01&to=2099-01-01')).status, 200);
    assert.match((await admin('/admin/reports?from=2020-01-01&to=2099-01-01')).html, /0 sessions played/);
    assert.match((await admin('/admin/reports?from=2026-99-99&to=2099-01-01')).html, /Choose a valid start/);
    response = await admin('/sports', { method: 'POST', data: { name: 'Hockey' } });
    assert.equal(response.status, 403);
    await run('INSERT INTO sessions(sport_id,creator_id,starts_at,venue,extra_capacity) VALUES(1,1,?,?,0)', '2024-01-01T10:00:00.000Z', 'Old Ground');
    assert.match((await admin('/admin/reports?from=2024-01-01&to=2024-12-31')).html, /1 sessions played/);
    assert.match((await admin('/admin/reports?from=2024-01-01&to=2024-12-31')).html, /100\.0%/);
  } finally { await new Promise(resolve => server.close(resolve)); await closeDatabase(); }
});
