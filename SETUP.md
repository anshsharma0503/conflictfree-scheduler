# ConflictFree – Setup Guide

Smart meeting scheduling and shared-room/equipment booking. The backend is Node.js + Express + MongoDB, and the frontend is React + Vite.

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

## 4. Install and run

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

## 5. Google sign-in (optional)

Email/password works without any extra steps. "Continue with Google" uses the project owner's Google Cloud app, which is in testing mode, so **the owner must add your Google account as a Test user**. They do that in Google Cloud Console → *APIs & Services* → *OAuth consent screen*. The backend must run on port 5000 for Google sign-in to work.

## 6. Run the tests (optional)

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

More detail is in `docs/`: `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `PROGRESS.md`.
