# ConflictFree – Setup Guide

Smart meeting scheduling and shared-room/equipment booking. The backend is Node.js + Express + MongoDB, and the frontend is React + Vite.

## Quick start (Windows)

Install **Node.js 22+** and **Docker Desktop**, then from the project root (double-click or run in a terminal):

```
.\setup.cmd      # once: creates backend\.env, installs packages, starts Redis, checks every service
.\start.cmd      # every time: Docker + Redis, MongoDB (if local), backend :5000, frontend :5173, opens the browser
```

- Press **Ctrl+C** in the start window to stop the backend and frontend. Redis keeps running; stop it with `.\start.ps1 -Down`.
- `setup.cmd` never overwrites existing `backend\.env` values. The only exception is a placeholder or empty `JWT_SECRET`, which it replaces with a random one. After filling in `MONGODB_URI` (and optionally `GEMINI_API_KEY`), run it again to re-check.
- Options: `.\setup.ps1 -WithE2E` (also installs the Playwright browser), `-SkipInstall`, `-NoDocker`; `.\start.ps1 -SeparateWindows` (backend and frontend in their own windows), `-NoBrowser`, `-StopRedisOnExit`.
- Check services at any time: `cd backend` then `npm run check:services` (add `-- --gemini` to also verify the Gemini key).
- Local MongoDB instead of Atlas: `start.cmd` starts the `MongoDB` Windows service, or a portable `mongod` if you set `$env:CONFLICTFREE_MONGOD` (and `$env:CONFLICTFREE_MONGOD_CONFIG`).
- `start.cmd` refuses to start if port 5000 or 5173 is already taken, and names the program using it.

The sections below explain each step in detail, for manual setup or other operating systems.

## 1. Install prerequisites

- **Node.js 22 LTS or newer**: https://nodejs.org (check with `node -v`)
- A **MongoDB Atlas** account (free): https://www.mongodb.com/cloud/atlas

## 2. Create the database (MongoDB Atlas)

1. In Atlas, create a **free M0 cluster**. Keep the default *replica set* type, not *sharded*. ConflictFree needs a replica set for its atomic booking transactions, and every normal Atlas cluster already is one.
2. **Database Access** → *Add New Database User* → username and password → role **Read and write to any database**.
3. **Network Access** → *Add IP Address* → *Add Current IP Address*. For quick testing you can use `0.0.0.0/0` instead.
4. **Connect** → *Drivers* → copy the connection string. It looks like:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

## 3. Configure the backend

Open `backend/.env` (included) and set `MONGODB_URI` to your Atlas string. Add the database name `conflictfree` after `.net/`:

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/conflictfree?retryWrites=true&w=majority&appName=Cluster0
```

- If the password contains special characters, URL-encode them (`@` → `%40`, `#` → `%23`, `:` → `%3A`).
- Leave `PORT=5000` and `FRONTEND_URL=http://localhost:5173` as they are.
- `JWT_SECRET` is still a placeholder. That's fine for local use, but replace it with a long random string before any real deployment.
- `backend/.env` contains a real Google OAuth client secret. **Do not upload it to GitHub or share it further.**

## 4. Start Redis (notifications and reminders)

In-app notifications and event reminders use BullMQ, which needs Redis. Locally Redis runs in Docker:

1. Install and start **Docker Desktop**: https://www.docker.com/products/docker-desktop
2. From the repository root (the folder with `docker-compose.yml`):
   ```
   docker compose up -d redis
   docker compose ps
   ```
   Expected: `conflictfree-redis ... (healthy)   127.0.0.1:6379->6379/tcp`
3. `backend/.env` already contains `REDIS_URL=redis://127.0.0.1:6379`.

Stop it with `docker compose down`; queued jobs are kept in a Docker volume. Without Redis the app still works, but notifications and reminders are off and the bell says they are paused.

For deployment, use a managed Redis and set `REDIS_URL` to its TLS URL:
- Redis Cloud: `rediss://default:<password>@<host>:<port>`. Set the database's eviction policy to **noeviction**.
- Upstash: `rediss://default:<token>@<name>.upstash.io:6379`. BullMQ workers keep polling even when idle, which counts toward pay-per-request pricing, so prefer a fixed-price plan.

### Scheduling assistant (optional, Google Gemini)

1. Create a key at https://aistudio.google.com/apikey.
2. Add it to `backend/.env`: `GEMINI_API_KEY=...`. Never commit it.
3. Check it works (six sample sentences, each one a paid model call):
   ```
   cd backend
   npm run assistant:smoke
   ```
   Expected: lines starting with ✔, each showing the model used and about 1–3s.

Without a key, the "Describe it" box on Find a time is simply hidden. The model can be changed with `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` (see `.env.example`).

## 5. Install and run

Use two terminals.

**Terminal 1: backend**
```
cd backend
npm install
npm run dev
```
Expected output: `ConflictFree API running on port 5000`

**Terminal 2: frontend**
```
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, then **Register** with an email and password and you're in.

To try the live updates, open a second browser (or a private window) and register a second user. Invite them from **New event**. The invitation appears for the other user instantly.

## 6. Google sign-in (optional)

Email/password works without any extra steps. "Continue with Google" uses the project owner's Google Cloud app, which is in testing mode, so **the owner must add your Google account as a Test user**. They do that in Google Cloud Console → *APIs & Services* → *OAuth consent screen*. The backend must run on port 5000 for Google sign-in to work.

## 7. Run the tests (optional)

```
cd backend
npm test                      # uses the "conflictfree_test" database

cd ../frontend
npm test                      # unit/component tests, no database needed
npx playwright install chromium
```

End-to-end tests start their own servers on ports 5100/5180. Point them at Atlas (PowerShell):

```
$env:E2E_MONGODB_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/conflictfree_e2e?retryWrites=true&w=majority"
npm run test:e2e
```

- Test databases **must** end in `_test` / `_e2e`. The tests refuse to touch anything else, so your real data is safe.
- Over Atlas, tests run slower than on a local database.
- Backend queue tests and E2E also need Redis running (`docker compose up -d redis`). Their jobs use their own key prefixes (`cftest`, `cfe2e`), so your development jobs in the same Redis are never touched.

## Alternative: local MongoDB instead of Atlas

1. Install MongoDB Community Server 8.x: https://www.mongodb.com/try/download/community
2. Enable a replica set. Add the following to `mongod.cfg`:
   - Windows: `C:\Program Files\MongoDB\Server\8.x\bin\mongod.cfg`
   - macOS (Homebrew): `/opt/homebrew/etc/mongod.conf`
   - Linux: `/etc/mongod.conf`
   ```
   replication:
     replSetName: rs0
   ```
   Then restart MongoDB:
   - Windows, admin PowerShell: `Restart-Service MongoDB`
   - macOS: `brew services restart mongodb-community`
   - Linux: `sudo systemctl restart mongod`
3. Initialize the replica set once: `cd backend && npm run db:init-replset`
4. In `backend/.env`: `MONGODB_URI=mongodb://127.0.0.1:27017/conflictfree?replicaSet=rs0`

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Atomic scheduling requires a MongoDB replica set.` (HTTP 503) | Use an Atlas replica-set cluster, or enable `rs0` locally (see above). |
| `MongooseServerSelectionError` / timeout | Atlas: check Network Access (your IP) and the username/password in the URI. Local: is MongoDB running? |
| `bad auth : authentication failed` | Wrong Atlas user/password, or the password needs URL-encoding. |
| Port 5000 or 5173 already in use | Close the other program, or set `PORT=5001` in `backend/.env` (Google sign-in then won't work). |
| Live indicator stuck on "Reconnecting…" | Make sure the backend is running and you opened the app at `http://localhost:5173`. |
| "Describe it" is missing on Find a time | Set `GEMINI_API_KEY` in `backend/.env` and restart the backend. |
| Assistant says "busy right now" | Gemini is over capacity for a moment, even after the fallback model and a retry. Try again shortly; the normal form keeps working. |
| Assistant says "not available" and the log shows `assistant_upstream_rejected` | The key is invalid or the model was retired. Check `GEMINI_API_KEY`, or set `GEMINI_MODEL` to a current model. |
| Times look shifted by several hours | Your account is on UTC: click **Use <your zone>** under "Time zone" in the sidebar. |
| Bell says notifications are paused / log shows `queues_disabled` or `redis_connection_error` | Start Redis: `docker compose up -d redis`, and check `REDIS_URL` in `backend/.env`. The API reconnects by itself. |
| `docker compose` fails with "cannot connect to the Docker daemon" | Start Docker Desktop and wait until it says it is running. |
| Queue tests fail with "Redis is required for queue tests" | Same: start Redis with `docker compose up -d redis`. |

More detail is in `docs/`: `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `PROGRESS.md`.
