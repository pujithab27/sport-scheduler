# Sport Scheduler

A web app for administrators to manage sports and view reports, and for players to create and join sport sessions. A session creator can cancel with a reason visible to joined players.

## Local setup

Requires Node.js 24 and npm or pnpm.

1. Install dependencies with `npm install` or `pnpm install`.
2. Set `SESSION_SECRET` to a random string of at least 32 characters. For example: `export SESSION_SECRET="$(openssl rand -hex 32)"`.
3. Run `npm start` or `pnpm start`, then open `http://localhost:3000`.

Without `DATABASE_URL`, the app uses a local PGlite database in `data/pglite`. `DB_PATH` changes that local directory. The schema is created automatically on first start. `PORT` changes the server port.

### Create an administrator locally

Public sign-up creates players only. Set `ADMIN_PASSWORD` to a password of at least 12 characters, then run:

```sh
node src/setup-admin.js "Admin Name" admin@example.com
```

Remove `ADMIN_PASSWORD` from the environment afterward. An existing player's role cannot be changed with this command.

### Import the previous SQLite database

If you used an earlier version of this project, its database is still at `data/scheduler.sqlite`. With the app stopped, run `node src/import-sqlite.js` to import users, sports, sessions, and participants into an **empty** PGlite database. The command never deletes the old file. Login sessions are not copied, so sign in again afterward.

To import into a hosted PostgreSQL database instead, set `DATABASE_URL` first and run the same command. Keep that connection string private.

## Free deployment: Render + Neon

Render Free can host the web app. Its filesystem is temporary, so use a hosted PostgreSQL database such as Neon's Free plan to keep accounts and sessions. Do not set `DB_PATH` on Render.

1. Publish this folder to a **private** GitHub repository. The `.gitignore` excludes local databases, dependencies, and `.env` files.
2. Create a Neon PostgreSQL project. Copy its connection string, which starts with `postgresql://`. Keep it private.
3. In Render, create a **Free Web Service** connected to the GitHub repository. Use build command `npm install` and start command `npm start`.
4. Add these Render environment variables:
   - `DATABASE_URL`: the Neon connection string
   - `SESSION_SECRET`: a random value of at least 32 characters
   - `NODE_ENV`: `production`
   - `TRUST_PROXY`: `1`
   - `BOOTSTRAP_ADMIN_NAME`: the first administrator's name
   - `BOOTSTRAP_ADMIN_EMAIL`: the first administrator's email
   - `BOOTSTRAP_ADMIN_PASSWORD`: a password of at least 12 characters
5. Deploy. The app creates its tables and the first administrator on startup. Once the site works, **remove the three `BOOTSTRAP_ADMIN_*` variables** from Render and redeploy. The admin account remains in Neon.
6. Open the public `onrender.com` URL. Sign in, create a sport, and verify it remains after a restart or redeploy.

Never commit `DATABASE_URL`, `SESSION_SECRET`, or passwords to GitHub. Render Free may sleep when idle, so its first request after a pause can be slow. Check Render and Neon for their current free-plan limits.

## Match rules

- Additional places are counted across both teams; a joining user chooses a team.
- Names entered during session creation are display names and are not linked to accounts.
- The creator is not automatically counted as a participant. Enter their name in a team if they are playing.
- A past, non-cancelled session counts as played. Sport popularity is the share of played sessions by sport.
- Session times use the browser's local time and are stored in UTC. Report dates use UTC boundaries.
- Only the creator can cancel a session. Joining closes after its start or cancellation.

These rules filled gaps in the course screenshots and were approved before implementation.

## Tests and structure

Run `npm test` or `pnpm test`. The integration test starts an isolated web server and an in-memory PostgreSQL-compatible database.

- `src/app.js`: routes, validation, permissions, and reporting
- `src/db.js`: local PGlite or hosted PostgreSQL connection and schema
- `src/session-store.js`: persistent login sessions
- `src/views/`: server-rendered pages
- `src/public/`: responsive styling
- `tests/`: end-to-end app test

## Submission materials

The course screenshots suggest adding application screenshots, a live URL, and a video demonstration to this README after those artifacts exist.
