# ConflictFree Architecture

## Current Architecture

ConflictFree currently has two main applications:

```text
conflictfree-scheduler/
├─ backend/
├─ frontend/
├─ docs/
├─ scripts/
│  └─ dev-common.ps1    # helpers shared by setup.ps1 / start.ps1
├─ docker-compose.yml   # local Redis only (Decision 43)
├─ setup.cmd / setup.ps1   # one-time setup: .env, npm install, Redis, MongoDB, service check
└─ start.cmd / start.ps1   # run everything: Docker/Redis, MongoDB, backend :5000, frontend :5173
```

`backend/scripts/checkServices.js` (`npm run check:services`) is the health check both scripts use.

Runtime services:

| Service | Development | Production (planned, Phase P) |
| --- | --- | --- |
| MongoDB (replica set `rs0`) | local Community Server | MongoDB Atlas |
| Redis (BullMQ) | Docker container `conflictfree-redis` (`redis:7.4-alpine`, `noeviction`, AOF) | Redis Cloud or Upstash via `REDIS_URL=rediss://…` |
| Google Gemini (assistant) | Gemini API with `GEMINI_API_KEY` | same |

## Backend

The backend is a Node.js and Express API.

### Backend Responsibilities

- Expose REST API routes.
- Connect to MongoDB.
- Authenticate users with JWT / HTTP-only cookies and Google OAuth.
- Store users in MongoDB.
- Store calendar events in MongoDB.
- Detect scheduling conflicts across user events.
- Rank available slots using custom Min-Heap and heuristic scoring.
- Protect private routes.
- Scope private data to the authenticated user.
- Later provide resource management, graph coloring, real-time updates, and AI services.

### Backend Entry Points

- `backend/src/app.js` creates the Express app, mounts middleware and routes, then a JSON 404 for unknown `/api/*` routes and the central JSON error handler (`middleware/errorHandler.js`).
- `backend/src/server.js` loads environment variables, connects to MongoDB, creates a Node `http` server, attaches the Socket.io server (`realtime/socketServer.js`), starts the BullMQ queues and workers (`queues/queueService.js`), and handles SIGINT/SIGTERM with a graceful shutdown (Socket.io → HTTP → BullMQ workers/queues/Redis → MongoDB, with a 10s forced-exit fallback).

### Shared Calendar Query Builders (`services/scheduling/calendarQueryService.js`)

One definition of "this event occupies these users' calendars" is used by conflict checks, slot search, meeting confirmation, RSVP, and meeting moves:
- `buildBlockingEventQuery({ userIds, startAt, endAt, excludeEventId })`: non-cancelled events overlapping `[startAt, endAt)` (open interval, so back-to-back events never conflict) that are owned by the users, or where they hold a `pending`/`accepted` invitation.
- `buildEventVisibilityMatcher(userId)`: owner, or registered participant by `participants.user`.
- Participants are always matched by the verified `participants.user` reference, never by free-text email (Decision 32).

### Real-time Updates (Phase L)

- **Transport:** Socket.io 4 on the same HTTP server and port as the API, path `/socket.io`. In development the frontend reaches it through the Vite proxy (`/socket.io`, `ws: true`; target from `API_PROXY_TARGET`, default `http://localhost:5000`).
- **Authentication:** the handshake reads the existing HTTP-only `conflictfree_token` cookie. Query and `auth`-payload tokens are ignored. Browser handshakes from non-allow-listed Origins are rejected (`config/origins.js`). The socket is disconnected with `session:expired` when the JWT expires.
- **Rooms:** the server joins each socket to `user:<userId>` (private) and `authenticated` (non-private broadcasts). Clients cannot join rooms.
- **Publishing:** `services/schedulingEvents.js` is called by controllers after commit. `realtime/realtimeService.js` does the emitting and is a no-op when no Socket.io server is attached (e.g. supertest-only tests).

| Event | Recipients | Payload |
| --- | --- | --- |
| `session:ready` | the connecting socket | `{ userId }` |
| `session:expired` | the socket whose JWT expired | `{ reason: "token_expired" }` |
| `event:created` / `event:updated` | owner (all tabs) | `{ event }` |
| `event:deleted` | owner + registered participants | `{ eventId }` |
| `meeting:confirmed` | organizer | `{ meeting }` |
| `invitation:created` | each invitee | `{ meeting }` |
| `invitation:accepted` / `invitation:declined` | organizer + all registered participants | `{ meeting, responderId, status }` |
| `meeting:updated` | organizer + all registered participants | `{ meeting }` |
| `meeting:cancelled` | organizer + all registered participants | `{ meeting }` |
| `resource:created` / `resource:updated` / `resource:deactivated` | all authenticated sockets | `{ resource }` (same safe summary as `GET /api/resources`) |
| `resource:booking-changed` | all authenticated sockets | `{ resourceId }` only |

Every payload also carries `occurredAt` (ISO-8601 UTC).

**Frontend client:**
- `services/realtimeClient.js`: same-origin `io({ path: "/socket.io", withCredentials: true })` with automatic reconnection. It authenticates with the HTTP-only cookie only.
- `hooks/useRealtimeUpdates.js`: one socket per mount, and one listener per event name, dispatched through a handler ref. It returns `connecting | live | reconnecting | offline`. It calls `onResync` after a reconnect and `onSessionExpired` on `session:expired` or an auth rejection.
- `context/DashboardProvider.jsx`: the provider is mounted once for `/dashboard/*`, so navigating between pages never opens extra sockets. It upserts or removes pushed records by id, idempotently with its own HTTP responses (Decision 41). It flags slot results stale on calendar or booking changes and exposes `realtimeStatus`, `availabilityStale`, and `handleRefreshAvailability`.
- `components/AppShell.jsx`: connection indicator. `pages/dashboard/FindTimePage.jsx`: the "may be out of date" notice with Search again.

### Background Jobs and In-App Notifications (Phase M)

```text
controller (after commit)
  └─ services/schedulingEvents.js ── Socket.io push (Phase L, unchanged)
                                 └── enqueueNotification(type, { ids only })
                                         │  Redis (BullMQ, prefix BULLMQ_PREFIX)
                                         ▼
                         "notifications" Worker ── reload meeting from MongoDB
                                         │          build records (notificationRules.js)
                                         ▼
                         Notification collection (upsert by user + dedupeKey)
                                         │
                                         ▼
                         Socket.io "notification:created" → recipient's room

"reminders" job scheduler (every REMINDER_SWEEP_INTERVAL_MS, default 60s)
  └─ Worker runs runReminderSweep(now) → same Notification upsert + push
```

- **Configuration** (`config/redis.js`): `REDIS_URL` (`redis://` locally, `rediss://` for Upstash / Redis Cloud; TLS is implied by the scheme), `BULLMQ_PREFIX` (default `conflictfree`; tests use `cftest`, E2E `cfe2e`), `REMINDER_SWEEP_INTERVAL_MS` (default 60000, minimum 1000). Without `REDIS_URL` the API starts normally with notifications disabled (Decision 44).
- **Connections:** one producer connection for both queues, with `enableOfflineQueue: false` and `maxRetriesPerRequest: 1` so HTTP requests never wait on Redis. Each worker gets its own connection with `maxRetriesPerRequest: null`, as BullMQ requires for blocking commands.
- **Queues** (`queues/queueService.js`):

| Queue | Jobs | Options |
| --- | --- | --- |
| `notifications` | `invitation.created`, `invitation.responded`, `meeting.updated`, `meeting.cancelled` | custom `jobId` = UUID; 5 attempts, exponential backoff from 1s; completed kept 1h / 1000, failed kept 7 days; concurrency 5 |
| `reminders` | `sweep`, created by job scheduler `reminder-sweep` (`upsertJobScheduler`, `every`) | 1 attempt (the next sweep retries naturally); concurrency 1 |

- **What triggers a notification job** (all from `services/schedulingEvents.js`, after the write committed):

| Domain change | Job | Recipients (computed by the worker) |
| --- | --- | --- |
| `POST /api/meetings/confirm` | `invitation.created` `{ eventId }` | every registered invitee |
| `PATCH /api/meetings/:id/invitation-response` | `invitation.responded` `{ eventId, responderId, status }` | the organizer |
| `PATCH /api/events/:id` on a shared meeting, when time, location or resource changed | `meeting.updated` `{ eventId, changes }` | invitees who have not declined |
| `POST /api/meetings/:id/cancel` | `meeting.cancelled` `{ eventId }` | every registered invitee |
| `DELETE /api/events/:id` on a shared meeting | `meeting.cancelled` `{ deleted: true, snapshot }` | every registered invitee (from the snapshot) |

- **Jobs carry ids, not content.** The worker reloads the meeting, so it notifies about the current state and skips meetings that no longer exist or were cancelled in the meantime. The one exception is a deleted meeting, whose job carries a minimal snapshot (owner id, title, start/end, participant ids).
- **Idempotency:** every record has a `dedupeKey`, unique per user. Meeting jobs use `<type>:<jobId>`, so a retried job writes the same keys. Reminders use `event.reminder:<eventId>:<startAt ISO>`, so repeated sweeps never duplicate a reminder, while moving an event produces a new one. Records are written with `bulkWrite` `updateOne` + `$setOnInsert` + `upsert`; only newly inserted documents are pushed over Socket.io.
- **Reminder sweep** (`queues/processors.js` → `runReminderSweep`): loads active events starting in `(now, now + 1440 min]` (index `{ startAt: 1, status: 1 }`), the recipients' `reminderMinutesBefore`, and creates a reminder for each recipient whose lead time has been reached. Recipients are the organizer and participants who **accepted**. Pending and declined invitees are not reminded. Because the sweep re-derives everything from MongoDB, a late or missed sweep still catches every event that has not started (Decision 45).
- **Scheduler watchdog:** every 5–60s (three sweep intervals, clamped) the API checks that the `reminder-sweep` scheduler exists in Redis and re-creates it if missing. This covers Redis being down at startup and Redis losing its data while the API keeps running.
- **Failure behaviour:** `enqueueNotification` never throws. When the producer connection is not ready it skips the job and logs `notification_enqueue_skipped`; an add that takes longer than 3s is abandoned and logged. The HTTP response is unaffected. `getQueueStatus()` returns `disabled | starting | ready | degraded` and is exposed to the UI as `deliveryStatus`. Shutdown closes workers (a running job finishes), then queues, then connections, each with a 5s timeout.
- **Known limitation:** a meeting notification for an action taken while Redis is unreachable is not created later. Reminders are not affected. A transactional outbox would close this gap and is deferred (Decision 44).

**API** (`routes/notificationRoutes.js`, all behind `requireAuth`, always scoped to `req.user.id`):

```text
GET    /api/notifications?limit=20&before=<notificationId>&unread=true
         → { notifications, unreadCount }   (newest first, limit ≤ 50, cursor = id)
PATCH  /api/notifications/:id/read          → { notification, unreadCount } (others' ids → 404)
POST   /api/notifications/read-all          → { updated, unreadCount }
GET    /api/notifications/preferences       → { preferences }
PATCH  /api/notifications/preferences       { reminderMinutesBefore } → { preferences }
         preferences = { reminderMinutesBefore, reminderOptions: [0,5,10,15,30,60,1440], deliveryStatus }
```

Serialized notification: `{ id, type, message, eventId, data: { eventTitle, startAt, endAt, actorName, status }, read, readAt, createdAt }`. The recipient's user id is not echoed.

**Socket.io events added in Phase M** (private `user:<id>` room only):

| Event | Payload |
| --- | --- |
| `notification:created` | `{ notification, unreadCount }` |
| `notification:read` | `{ notificationIds, unreadCount }` or `{ all: true, unreadCount }` (keeps other tabs in sync) |

**Frontend:** `services/notificationService.js`; `DashboardProvider` loads notifications and preferences on mount and on reconnect, upserts pushed notifications by id (capped at 50 in memory), applies `notification:read`, and shows reminder pushes on the status line. `components/NotificationBell.jsx` in the top bar shows the unread badge, a popover list (unread dot + bold text + hidden "(unread)" label), "Mark all as read", the reminder lead-time select, and a notice when `deliveryStatus` is not `ready`. Escape or an outside click closes it, and focus returns to the bell.

### Natural-Language Scheduling Assistant (Phase N)

```text
Find a time → "Describe it" ──POST /api/assistant/parse-request { text }──▶ assistantController
  1. validateRequestText (3–500 chars)            → 400, no quota used
  2. per-user limiter 10/min                      → 429 + Retry-After
  3. load the user's stored timezone
  4. geminiClient.generateJson                    → Gemini (sentence + local time + 14-day date table + JSON schema)
       primary model → fallback model → (both busy) wait 1.5s → one more pass
  5. normalizeSchedulingDraft                     → validated draft + assumptions
       people → createParticipantResolver → participant Trie (registered users only)
◀── { request: draft, model }
UI shows the interpretation → "Search these times" (smart suggestions) or "Fill the form only"
```

- **Files:** `config/gemini.js`, `services/assistant/geminiClient.js` (REST, timeouts, fallback, busy retry, `AssistantError`), `schedulingPrompt.js` (system instruction, date table, response schema), `schedulingRequestParser.js` (validation and normalization), `assistantService.js` (client singleton, participant resolver, quota), `rateLimiter.js`, `controllers/assistantController.js`, `routes/assistantRoutes.js`, `scripts/assistantSmoke.js`.
- **Configuration:** `GEMINI_API_KEY` (required to enable), `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_FALLBACK_MODEL` (default `gemini-3.1-flash-lite`; `none` disables it), `GEMINI_TIMEOUT_MS` (default 12000, allowed 1000–60000). Request settings: temperature 0, `maxOutputTokens` 1024, `thinkingLevel: "minimal"`.
- **API** (both behind `requireAuth`):

```text
GET  /api/assistant/status         → { assistant: { enabled, model } }
POST /api/assistant/parse-request  { text } → { request, model }
     request = {
       title, durationMinutes, timezone,
       windowStart, windowEnd,              // UTC ISO
       windowStartLocal, windowEndLocal,    // "YYYY-MM-DDTHH:mm" in the user's zone
       participants: [{ query, status: "matched"|"ambiguous"|"not_found", matches: [{ id, name, email }] }],
       preferences: { preferredStartHour?, preferredEndHour?, avoidEarlyMorning?, avoidLateDay? },
       resource: { type: "room"|"equipment"|null, attendeeCount|null },
       assumptions: [string], clarification: string
     }
Errors: 400 bad text · 401 · 422 not a scheduling request / past window / blocked · 429 · 502 upstream misconfiguration · 503 not configured or busy · 504 timeout
```

- **Frontend:** `services/assistantService.js`; `components/RequestAssistant.jsx`, shown on Find a time only when `/api/assistant/status` says it is enabled. The provider's `handleApplyAssistantRequest(draft, people, { search })` fills `slotSearchData`, the picked participants and the composer title. With `search: true` it calls `handleFindSuggestions(undefined, { searchData, participants })` on those exact values; the search builders accept explicit data for this.
- Privacy and safety rules: Decision 47. Model choice and failure policy: Decision 48. Cost control and testing: Decision 49.

### Backend Folder Structure

```text
backend/src/
├─ config/
│  ├─ database.js
│  ├─ gemini.js                # GEMINI_API_KEY / models / timeout
│  ├─ origins.js
│  └─ redis.js                 # REDIS_URL / BULLMQ_PREFIX / sweep interval, ioredis connections
├─ controllers/
│  ├─ assistantController.js
│  ├─ authController.js
│  ├─ eventController.js
│  ├─ meetingController.js
│  ├─ notificationController.js
│  ├─ participantController.js
│  ├─ resourceController.js
│  └─ schedulingController.js
├─ middleware/
│  ├─ errorHandler.js
│  └─ requireAuth.js
├─ models/
│  ├─ Event.js
│  ├─ Notification.js
│  ├─ Resource.js
│  └─ User.js
├─ queues/
│  ├─ processors.js            # notification job processor, reminder sweep
│  └─ queueService.js          # queues, workers, scheduler, watchdog, enqueue
├─ realtime/
│  ├─ realtimeService.js
│  └─ socketServer.js
├─ routes/
│  ├─ assistantRoutes.js
│  ├─ authRoutes.js
│  ├─ eventRoutes.js
│  ├─ meetingRoutes.js
│  ├─ notificationRoutes.js
│  ├─ participantRoutes.js
│  ├─ resourceRoutes.js
│  └─ schedulingRoutes.js
├─ services/
│  ├─ assistant/
│  │  ├─ assistantService.js        # client singleton, participant resolver, quota
│  │  ├─ geminiClient.js            # REST client: timeout, fallback, busy retry
│  │  ├─ rateLimiter.js             # per-user sliding window
│  │  ├─ schedulingPrompt.js        # system instruction, date table, JSON schema
│  │  └─ schedulingRequestParser.js # validation + normalization of the model's answer
│  ├─ notifications/
│  │  ├─ notificationRules.js    # pure: recipients, wording, due reminders
│  │  └─ notificationService.js  # idempotent create, list, read, push
│  ├─ scheduling/
│  │  ├─ availableSlotService.js
│  │  ├─ backtrackingSchedulingService.js
│  │  ├─ conflictDetectionService.js
│  │  ├─ minHeapService.js
│  │  ├─ participantAvailabilityService.js
│  │  ├─ segmentTreeService.js
│  │  └─ slotScoringService.js
│  ├─ search/
│  │  ├─ participantSearchService.js
│  │  └─ trieService.js
│  ├─ authCookieService.js
│  ├─ authService.js
│  ├─ googleOAuthService.js
│  ├─ passwordService.js
│  ├─ resourceAvailabilityService.js
│  ├─ resourceService.js
│  ├─ timezoneService.js
│  └─ tokenService.js
├─ app.js
└─ server.js
```

### Backend Authentication Design

Authentication supports two providers:
- Manual local authentication (email + bcrypt password)
- Google OAuth authentication

Both auth flows create the same application session:
`JWT → HTTP-only cookie → /api/auth/me → frontend auth state`

The frontend does not read or store the JWT in JavaScript storage.

#### Auth Routes

- `POST /api/auth/register` (`{ name, email, password, timezone? }`; an invalid or missing timezone is stored as UTC)
- `POST /api/auth/login`
- `GET  /api/auth/google`
- `GET  /api/auth/google/callback`
- `GET  /api/auth/me`
- `PATCH /api/auth/me` (`{ timezone }`, IANA names only; Decision 51)
- `POST /api/auth/logout`

The user's stored timezone is the single source for reading and showing local times: reminders, the week calendar, slot preferences, and the assistant's relative dates. The frontend sends the browser's zone at sign-up. The sidebar offers "Use <browser zone>" when the account's zone differs.

### Backend Event Design

Events are stored in MongoDB and belong to one authenticated user.
Every event query is scoped by: `owner: req.user.id`.

#### Event Routes

- `POST   /api/events`
- `GET    /api/events`
- `GET    /api/events/:id`
- `PATCH  /api/events/:id`
- `DELETE /api/events/:id`

All event routes use `requireAuth`.

### Backend Scheduling & Optimization Design

The scheduling engine provides conflict detection, available slot discovery, and preference-based heuristic scoring with Min-Heap ranking.

#### Conflict Detection Service (`conflictDetectionService.js`)

- `normalizeTimeRange({ startAt, endAt })`: Validates presence, validity, and ensures `endAt > startAt`.
- `eventsOverlap(rangeA, rangeB)`: Pure overlap calculation via open-interval test (`A.start < B.end && A.end > B.start`).
- `findConflictingEvents({ ownerId, startAt, endAt, excludeEventId, EventModel })`: Queries the database for overlapping events belonging to `ownerId`, optionally excluding `excludeEventId` for safe updates.

#### Custom Min-Heap (`minHeapService.js`)

- `MinHeap(comparator)`: Zero-dependency binary min-heap implementation built from scratch.
- `push(item)`: Appends item and restores heap order via `_bubbleUp`.
- `pop()`: Removes and returns root item and restores heap order via `_bubbleDown`.
- `peek()`: Returns root item without removal.
- `size`: Returns current count of heap elements.

#### Slot Scoring & Ranking Service (`slotScoringService.js`)

- `normalizeSlotPreferences(preferences)`: Validates optional preference numbers and boolean flags.
- `scoreSlot(slot, preferences, slotIndex)`: Calculates heuristic score clamped between 0 and 100 based on preferred hours (+30), early morning (<10:00: -15 / >=10:00: +5), late day (>17:00: -10 / <=17:00: +5), and earliest slot bonus (+10, +8, +6...), returning an array of readable reasons.
- `rankSlots(slots, preferences)`: Uses `MinHeap` with priority comparator `(a, b) => b.score - a.score || a.startAt - b.startAt` to sort candidate slots best-first.

#### Available Slot Finder Service (`availableSlotService.js`)

- `normalizeSlotSearchInput({ windowStart, windowEnd, durationMinutes, slotStepMinutes })`: Validates input dates and positive durations/step sizes.
- `buildBusyRanges(events)`: Normalizes events to time interval pairs.
- `slotOverlapsBusyRange(slot, busyRange)`: Checks overlap between a candidate slot and a busy range.
- `isSlotAvailable(slot, busyRangesOrTree)`: Validates availability against either an array of busy ranges or a `SegmentTree` instance.
- `findAvailableSlots({ ownerId, windowStart, windowEnd, durationMinutes, slotStepMinutes, preferences, EventModel })`: Queries overlapping events, builds busy ranges, constructs a discrete `SegmentTree`, steps candidate slots across the window, tests availability via tree range queries, and ranks available slots best-first via `rankSlots`.

#### Discrete Time Segment Tree (`segmentTreeService.js`)

- `SegmentTree({ windowStart, windowEnd, stepMinutes })`: Array-based binary tree of size `4 * N` over `N` discrete time buckets.
- `addBusyRange(range)`: Clamps input to the search window, converts to bucket index boundaries, and updates tree nodes in $O(\log N + K)$ operations.
- `isRangeFree(range)`: Validates range is within the window, converts to bucket boundaries, and checks vacancy across tree nodes in $O(\log N)$ time. Correctly allows back-to-back boundary alignments.
- `getCoveredIndexes()`: Collects all busy bucket indices across the window.

#### Backtracking Constraint Relaxation Service (`backtrackingSchedulingService.js`)

- `normalizeSuggestionInput(input)`: Validates search window, duration, positive step, minimum score (0–100), and max suggestions count.
- `buildRelaxationPlans(preferences)`: Returns an ordered 5-level relaxation plan hierarchy (Level 0 Strict through Level 4 All Relaxed).
- `applyRelaxationPlan(preferences, plan)`: Generates relaxed preference configurations corresponding to the plan level.
- `findSuggestionsWithRelaxation(...)`: Deterministically explores relaxation levels from Level 0 to Level 4, evaluating candidate slots and early-exiting upon the first successful level. Includes fallback to top Level 4 slots when over-constrained.

#### Participant Availability Service (`participantAvailabilityService.js`)

- `normalizeParticipantEmails(input)`: Validates email regex, trims, lowercases, and deduplicates emails using a `Set`.
- `formatParticipantSummary(user)`: Returns safe participant metadata (`{ id, name, email, timezone }`), strictly omitting passwords, OAuth tokens, and other private attributes.
- `resolveParticipants({ organizerId, participantEmails, UserModel, organizerFallback })`:
  - Fetches the organizer's fresh MongoDB User record and places them authoritative as `participants[0]`.
  - Filters out organizer's email from entered participants to avoid duplication.
  - Queries registered users case-insensitively using collation.
  - Rejects unknown emails with descriptive HTTP 400 errors (`User not found for participant email: <email>`).
  - Returns `{ participants: [organizer, ...attendees], userIds: [...] }`.

#### Multi-Owner Segment Tree Integration

- `findAvailableSlots` and `findSuggestionsWithRelaxation` accept `ownerIds` array.
- Executes a single efficient database query: `Event.find({ owner: { $in: userIds }, startAt: { $lt: windowEnd }, endAt: { $gt: windowStart } }).select("startAt endAt")`.
- Privacy projection: `select("startAt endAt")` ensures no private event titles, descriptions, locations, or attendee details are ever loaded into memory or exposed to other participants.
- Access policy: *“Any authenticated registered user may request opaque free/busy availability for explicitly entered registered-user emails. The API returns only safe participant summaries and mutually available slots, never event details.”*
- Feeds all combined busy intervals into `SegmentTree`, allowing $O(\log N)$ conflict-free candidate evaluation across all participants while cleanly permitting back-to-back meetings.
- The organizer's fresh MongoDB `User.timezone` record determines local preferences (e.g. morning/late day penalties) and time conversions.

#### Scheduling Routes

- `POST /api/scheduling/conflicts` (protected by `requireAuth`)
- `POST /api/scheduling/available-slots` (protected by `requireAuth`, supports optional `participantEmails`)
- `POST /api/scheduling/suggestions` (protected by `requireAuth`, supports optional `participantEmails`)


### Models

#### User Model (`User.js`)

- `googleId` (optional, unique sparse)
- `email` (required, unique)
- `name` (required)
- `avatarUrl` (optional)
- `timezone` (default: "UTC")
- `passwordHash` (for local users, excluded from queries by default)
- `authProvider` ("local" | "google")
- `calendarVersion` (Number, default: 0 — atomic write-conflict version counter for replica-set transaction locks)
- `reminderMinutesBefore` (Number, enum `[0, 5, 10, 15, 30, 60, 1440]`, default 15; 0 = reminders off). Users created before Phase M have no value and are treated as 15.

#### Notification Model (`Notification.js`, Phase M)

- `user` (ObjectId ref User, required): the recipient
- `type` (enum `invitation.created | invitation.responded | meeting.updated | meeting.cancelled | event.reminder`)
- `message` (String, required, max 300)
- `event` (ObjectId ref Event, default `null`; `null` for deleted meetings)
- `data` (`{ eventTitle, startAt, endAt, actorName, status }`, captured when created)
- `dedupeKey` (String, required)
- `readAt` (Date, default `null`)
- `createdAt` / `updatedAt`

Indexes:
- `{ user: 1, dedupeKey: 1 }` unique (idempotency)
- `{ user: 1, _id: -1 }` (newest-first list and id cursor)
- `{ user: 1, readAt: 1 }` (unread count)
- `{ createdAt: 1 }` TTL, `expireAfterSeconds` = 90 days

#### Resource Model (`Resource.js`)

- `name` (required, trim, max 100 chars)
- `type` ("room" | "equipment", required)
- `capacity` (Number, min 1, required)
- `isActive` (Boolean, default: true)
- `createdBy` (ObjectId ref User, required)
- `bookingVersion` (Number, default: 0 — atomic write-conflict version counter for replica-set transaction locks)

Indexes:
- `{ isActive: 1, type: 1, capacity: 1 }`
- `{ name: 1 }`

#### Event Model (`Event.js`)

- `owner` (ObjectId ref User, required)
- `title` (required, max 120 chars)
- `description` (optional, max 2000 chars)
- `startAt` (Date, required)
- `endAt` (Date, required)
- `timezone` (default: "UTC")
- `location` (optional)
- `participants` (`[{ user, email, name, status, respondedAt }]`)
  - `user`: ObjectId ref `User`, default `null`
  - `email`: String, required, lowercase, valid format
  - `name`: String, optional
  - `status`: String, enum `["pending", "accepted", "declined"]`, default `"pending"`
  - `respondedAt`: Date, default `null`
- `status`: String, enum `["active", "cancelled"]`, default `"active"`
- `resource`: ObjectId ref `Resource`, optional, default `null`
- `source` ("manual" | "google")
- `googleEventId` (optional)

Indexes:
- `{ owner: 1, startAt: 1 }`
- `{ owner: 1, endAt: 1 }`
- `{ resource: 1, startAt: 1 }`
- `{ resource: 1, endAt: 1 }`
- `{ "participants.user": 1, startAt: 1 }`
- `{ "participants.email": 1, startAt: 1 }`
- `{ "participants.user": 1, "participants.status": 1 }`
- `{ status: 1 }`
- `{ startAt: 1, status: 1 }` (reminder sweep window, Phase M)

---

## Frontend

The frontend is a React and Vite Single Page Application.

### Frontend Responsibilities

- Render user interface with clean, responsive styling.
- Handle client-side routing.
- Call backend APIs with credentials.
- Manage authenticated user state via `AuthContext`.
- Protect private routes via `ProtectedRoute`.
- Provide event CRUD, conflict warnings, preference-based available slot search, and multi-participant availability coordination.

### Frontend Folder Structure

```text
frontend/
├─ index.html                 # No external requests; fonts are bundled (Decision 50)
├─ public/favicon.svg         # Brand mark
└─ src/
   ├─ components/
   │  ├─ AppShell.jsx         # Sidebar + top bar layout for /dashboard/*
   │  ├─ AuthAside.jsx        # Illustration panel on public pages
   │  ├─ BrandMark.jsx
   │  ├─ Icon.jsx             # Inline stroke-SVG icon set
   │  ├─ NotificationBell.jsx # Top-bar bell, unread badge, notification popover (Phase M)
   │  ├─ ParticipantPicker.jsx
   │  ├─ RequestAssistant.jsx # "Describe it" Gemini panel on Find a time (Phase N)
   │  ├─ ProtectedRoute.jsx
   │  └─ dashboard/
   │     └─ WeekCalendar.jsx
   ├─ context/
   │  ├─ AuthContext.jsx
   │  ├─ DashboardProvider.jsx  # All dashboard state and actions
   │  └─ dashboardContext.js
   ├─ hooks/
   │  └─ useDashboard.js
   ├─ pages/
   │  ├─ AuthCallbackPage.jsx
   │  ├─ HomePage.jsx
   │  ├─ LoginPage.jsx
   │  ├─ NotFoundPage.jsx
   │  ├─ RegisterPage.jsx
   │  └─ dashboard/
   │     ├─ DashboardApp.jsx      # Nested routes under /dashboard/*
   │     ├─ OverviewPage.jsx
   │     ├─ EventsPage.jsx
   │     ├─ EventComposerPage.jsx
   │     ├─ FindTimePage.jsx
   │     └─ ResourcesPage.jsx
   ├─ services/               # apiClient, assistant, auth, event, health, meeting, notification,
   │                          # participantSearch, realtimeClient, resource, scheduling
   ├─ test/
   │  ├─ renderDashboard.jsx  # Renders the /dashboard/* route tree in tests
   │  └─ setup.js
   ├─ utils/
   │  ├─ calendarLayout.js    # Week layout, overlap columns, upcoming conflicts
   │  ├─ relativeTime.js      # "5 min ago", reminder option labels
   │  └─ timezone.js
   ├─ App.css                 # Design tokens and all component styles
   ├─ App.jsx
   ├─ index.css
   └─ main.jsx
```

### Frontend Routes

- `/` — Home page (product intro, API status, sign-in or signed-in user)
- `/login` — Login page
- `/register` — Register page
- `/auth/callback` — Google OAuth callback page
- `/dashboard/*` — Protected dashboard, rendered by `DashboardApp` inside `DashboardProvider` and `AppShell`:
  - `/dashboard` — Overview: week calendar, "Needs a decision" card for upcoming overlaps, meeting invitations inbox, rest of today
  - `/dashboard/events` — Events list with edit, delete, cancel meeting, and RSVP actions
  - `/dashboard/events/new` — Event composer for creating, editing, and confirming shared meetings, with inline conflict warning and a live checks panel
  - `/dashboard/find-time` — Available slots and smart suggestions, participant picker, room allocation, preferences
  - `/dashboard/resources` — Rooms and equipment list with create, edit, and deactivate
  - any other `/dashboard/...` path redirects to `/dashboard`
- `*` — 404 Not found page

### Frontend Dashboard State

- `DashboardProvider` owns every piece of dashboard state: events, the event form, slot search, suggestions, picked participants, resources, and invitations. It also owns every action, moved unchanged from the former single `DashboardPage.jsx`. Pages read it through `useDashboard()`.
- The provider is mounted once for `/dashboard/*`, so state survives navigation. Selecting a slot on Find a time fills the same form that the composer edits, then navigates to `/dashboard/events/new`.
- `handleSubmitEvent` and `handleConfirmSharedMeeting` return `true` on success. The composer then navigates to `/dashboard/events`.
- The shell's top bar shows the shared `statusMessage` in a `role="status"` line on every dashboard page.
- **Personal vs shared events:** personal events never send `participants`, because `/api/events` rejects a non-empty array. People are invited only through the participant picker. When at least one person is picked, the composer's single primary action becomes "Confirm shared meeting" (`POST /api/meetings/confirm`) instead of "Create event".

### Frontend Design System ("Instrument")

Defined as CSS custom properties at the top of `App.css`:

- Colour: warm paper ground `#F3F2EE`, white surfaces, hairline borders `#E3E1DA`, ink text `#15161A`. There are two signal colours: free/confirmed green `#0D6650` and conflict orange `#B4430E`, each with a light tint. Every state also has a shape cue: solid fill, dashed outline for invitations, hatching or outline for conflicts.
- Type: Geist for UI text, Geist Mono with tabular numbers for all times, dates, and counts. Both are self-hosted variable fonts from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, imported in `src/main.jsx` (Decision 50).
- Controls: 8px radius, 44px minimum touch targets, black primary buttons. Panels use a 12px radius and no drop shadows.
- Layout: a 240px sidebar that collapses into a top bar with a horizontally scrolling nav below 860px. Pages use a main column plus a side column that wraps on narrow screens. The week calendar scrolls horizontally inside its own box on phones.
- Icons are inline stroke SVGs (`Icon.jsx`). No emoji.

### Frontend Scheduling Integration

- **Conflict Check:** Before saving or updating an event, `checkEventConflicts` queries `POST /api/scheduling/conflicts`. If overlapping events exist, the composer shows an inline alert under the time fields listing the conflicting meetings, outlines the time inputs, and blocks saving until the time changes.
- **Week Calendar:** `WeekCalendar.jsx` lays out the user's events Monday–Sunday in their timezone using `utils/calendarLayout.js`. Overlapping events are drawn side by side in conflict colours. The visible hour range expands to fit early or late events. A "now" line marks the current time.
- **Upcoming Conflicts:** Overview runs `findUpcomingConflicts` over loaded events and surfaces the first overlap with a link to Find a time.
- **Available Slot Finder & Participant Autocomplete:** On Find a time (`FindTimePage.jsx`), users search for free slots within a window with preference filters. Participant autocomplete is backed by the Trie (`ParticipantPicker.jsx`): as organizers type, it queries matching registered users by name or email, and clicking a result adds that participant as a chip. Results are ranked rows with rank, time range, a score bar, reason tags, and the allocated resource. A Coordinated Participants panel lists everyone with name, email, and timezone. Selecting a row fills the event form and opens the composer.
- **Smart Suggestions:** Shares the same participant selection state, allowing constraint relaxation when multi-participant constraints cannot be satisfied strictly. When both searches have run, Ranked slots and Smart Suggestions appear as tabs.

### Backend Search & Trie Architecture (Phase G)

- **Custom Trie (`trieService.js`):** Built from scratch in pure JavaScript.
  - Nodes maintain a `children` Map and a `users` Map (indexed by user ID).
  - Multi-token indexing: Indexes full user names, individual name words, full emails, and email username prefixes.
  - Subtree traversal: Breadth-First Search (BFS) starting from the prefix node ensures closest and shortest matches are visited and returned first.
  - Automatic deduplication: A `Set` of visited user IDs ensures users matching across both name and email appear exactly once.
  - Performance:
    - Insertion: $O(L)$ where $L$ is key length.
    - Prefix Search: $O(P + M)$ where $P$ is prefix length and $M$ is the number of descendant nodes explored up to the limit (default 10, max 20).
  - Scope: Currently indexes registered participant names and emails for autocomplete. Shared resource and calendar event indexing extensions are planned for future phases.
- **Participant Search Service (`participantSearchService.js`):**
  - Enforces minimum 2 non-whitespace characters for search queries and valid integer limits (1 to 20).
  - Excludes the authenticated organizer from search results.
  - Invalidation-on-write caching: Trie is built lazily on first query and invalidated via `invalidateParticipantSearchCache()` upon user registration or profile updates in `authService.js`.
- **API Endpoint:** `GET /api/participants/search?q=<prefix>&limit=10` protected with `requireAuth`.

### Backend Shared Resources & Room Booking Design

Phase H introduces shared resources (meeting rooms, equipment) that can be manually selected during event creation and slot searches.

- **Resource Data Model (`Resource.js`):**
  - Schema: `name` (unique with case-insensitive collation index), `type` (`"room"` | `"equipment"`), `capacity` (integer $\ge 1$), `location`, `description`, `isActive` (boolean, default true), `createdBy` (`ObjectId` ref `User`).
  - Soft-deactivation lifecycle: `DELETE /api/resources/:id` sets `isActive: false` so historical calendar events retain referential integrity.
- **Resource Service (`resourceService.js`):**
  - Manages resource CRUD operations, enforcing creator permissions (HTTP 403 Forbidden for non-creators on update/deactivate) and duplicate name checks (HTTP 400).
  - Any authenticated user can list active resources sorted alphabetically.
- **Resource Availability Engine (`resourceAvailabilityService.js`):**
  - `validateResourceForBooking`:
    - Validates resource is active (HTTP 400).
    - Validates attendee count does not exceed capacity (HTTP 400).
    - Checks for conflicting bookings across open intervals: `{ resource: resourceId, startAt: { $lt: endAt }, endAt: { $gt: startAt } }`, excluding the current event if updating.
    - Rejects busy resources with HTTP 409 Conflict and message `"Resource is already booked for the requested time"` without leaking details of other users' bookings.
    - Allows back-to-back bookings where boundaries touch.
  - `findResourceBusyRanges`:
    - Queries busy ranges for a given resource within a scheduling window and returns `[{ startAt, endAt }]` for interval analysis.
- **Integration with Scheduling Services:**
  - `availableSlotService.js` and `backtrackingSchedulingService.js` accept `additionalBusyRanges` (resource busy blocks) and insert them into the `SegmentTree` along with participant busy intervals.
  - The slot finder and smart suggestions ensure proposed slots are mutually free for both participants and the selected resource.
- **Resource Routes:**
  - `POST   /api/resources`
  - `GET    /api/resources`
  - `GET    /api/resources/:id`
  - `PATCH  /api/resources/:id`
  - `DELETE /api/resources/:id`

### Graph Coloring Automatic Resource Allocation Engine (Phase I)

Phase I introduces automatic shared resource recommendation for candidate slots using a real custom Graph Coloring algorithm (`resourceGraphColoringService.js`).

- **Mathematical Model:**
  - **Vertices ($V$):** Each existing confirmed booking overlapping the candidate slot with an assigned resource is a fixed-color vertex $V_i$. The proposed candidate slot is an uncolored vertex $V_{cand}$.
  - **Edges ($E$):** An undirected edge exists between $V_i$ and $V_j$ if and only if their time intervals overlap in open sets:
    $$\text{start}_i < \text{end}_j \land \text{end}_i > \text{start}_j$$
    Back-to-back intervals ($\text{end}_i = \text{start}_j$) have no edge.
  - **Colors ($C$):** Each color is a resource ID. Existing bookings maintain fixed colors equal to their assigned resource ID ($c(V_i) = \text{resourceId}_i$). Existing confirmed bookings are never recolored.
  - **Color Palette ($P$):** Formed from all active resources matching capacity ($\text{capacity} \ge \text{attendeeCount}$) and optional resource type filter (`"room"` or `"equipment"`).
  - **Greedy Coloring:** The palette is deterministically ordered (alphabetically by resource `name` ascending, tie-broken by `_id` ascending). $V_{cand}$ is assigned the first color in $P$ not used by any adjacent vertex:
    $$\text{assignedColor} = \min_{c \in P} \{ c \mid c \notin \{ c(u) : (V_{cand}, u) \in E \} \}$$
  - **Discarding Unallocatable Candidates:** If every eligible color is used by adjacent neighbors (or no resource meets capacity/type criteria), the allocation returns `null`. Both the slot finder and suggestion engine discard candidate slots where no compatible resource can be allocated.
- **Privacy Guarantees:**
  - The graph query projects only `{ startAt: 1, endAt: 1, resource: 1 }` from MongoDB.
  - Private fields (titles, organizers, attendee lists, descriptions) are never queried or returned.
  - Results attach only safe resource metadata (`{ id, name, type, capacity, location }`) and an explainable reason string.

### Shared Meeting Confirmation & Invitation Architecture (Phase J)

Phase J turns discovered conflict-free time slots and auto-allocated resources into confirmed shared meetings with participant invitation tracking.

- **Canonical Shared Meeting Model:**
  - One canonical event document per meeting stored in MongoDB.
  - The creator is stored in `owner` (ObjectId ref User).
  - Invited users are stored in the embedded `participants` array, with user references, email, name, invitation status, and response timestamp.
  - Overall meeting status is tracked in `status` (`"active"` or `"cancelled"`).
- **Concurrency & Transaction Strategy:**
  - *Superseded by Phase K.* Meeting confirmation, RSVP acceptance, cancellation, resource-reserving event changes, and shared-meeting moves run inside replica-set transactions using the `calendarVersion`/`bookingVersion` lock strategy (see Decision 30). A standalone MongoDB fails closed with HTTP 503.
  - Conflicts discovered inside the transaction are rejected with a generic HTTP 409 Conflict that does not reveal the clashing event.
- **Meeting Service (`meetingService.js`):**
  - `confirmSharedMeeting`:
    - Validates inputs, converts times to UTC, and resolves registered participant emails using `resolveParticipants`.
    - Automatically excludes the organizer from the `participants` array (organizer is the meeting owner).
    - Checks that attendee count does not exceed resource capacity.
    - Runs immediate conflict rechecks across all participants and the reserved resource.
    - Creates the canonical `Event` document with initial participant status `"pending"`.
  - `listPendingInvitations`:
    - Queries active meetings where the authenticated user is listed in `participants` with `status: "pending"`.
    - Populates organizer and resource details for safe presentation in the invitee's inbox.
  - `respondToInvitation`:
    - Validates that the authenticated user is an invited participant.
    - If accepting, checks for scheduling conflicts against the invitee's calendar.
    - Updates participant `status` (`"accepted"` or `"declined"`) and records `respondedAt`.
  - `cancelMeeting`:
    - Enforces organizer-only authorization (HTTP 403 Forbidden for non-owners).
    - Sets meeting `status` to `"cancelled"` and preserves the event record for auditing while releasing participant calendars and resource availability.
- **Availability Query Integration:**
  - `availableSlotService.js` and `conflictDetectionService.js`:
    - Filter out cancelled events (`status: { $ne: "cancelled" }`).
    - Query both owned events and shared events where the user is an invited participant with `status: { $in: ["pending", "accepted"] }`.
    - Exclude declined invitations, ensuring declined meetings do not block future slot availability.
  - `resourceAvailabilityService.js` and `resourceGraphColoringService.js`:
    - Filter out cancelled bookings (`status: { $ne: "cancelled" }`), immediately restoring resource availability upon meeting cancellation.
- **Frontend Meeting & Invitation Architecture:**
  - `meetingService.js`: Client API client covering `/api/meetings/confirm`, `/api/meetings/invitations`, `/api/meetings/:id/invitation-response`, and `/api/meetings/:id/cancel`.
  - Dashboard pages (`frontend/src/pages/dashboard/`):
    - Overview's "Meeting invitations" inbox allows invitees to review and respond to incoming meeting requests.
    - The composer replaces "Create event" with "Confirm shared meeting" once at least one participant is picked.
    - Event rows on the Events page display meeting status (`Cancelled`) and participant RSVP statuses.
    - Active meetings show "Cancel meeting" for organizers, and in-place RSVP toggles for invitees.

---

## Testing

### Backend Testing

Backend uses Node's native test runner (`node:test`), `assert/strict`, `supertest`, and `socket.io-client`.
`npm test` preloads `tests/helpers/testEnv.js`, which forces a dedicated `*_test` database (Decision 31) and the BullMQ prefix `cftest`.
Integration tests require the local `rs0` replica set. `queue.integration.test.js` also requires Redis (`docker compose up -d redis`); it fails with that instruction if Redis is unreachable.
Test files are in `backend/tests/`:

- `health.test.js` — Health route checks
- `database.test.js` — MongoDB connection lifecycle
- `passwordService.test.js` — bcrypt hashing and verification
- `tokenService.test.js` — JWT signing and verification
- `authCookieService.test.js` — Cookie setting and extraction
- `googleOAuthService.test.js` — OAuth URL generation and profile handling
- `authService.test.js` — User registration and login business logic
- `requireAuth.middleware.test.js` — Auth middleware tests
- `user.model.test.js` — User schema validation
- `event.model.test.js` — Event schema validation and indexing
- `resource.model.test.js` — Resource schema validation, capacity, and types (5 tests)
- `resource.routes.test.js` — Resource CRUD endpoints, permissions, and soft-delete tests (8 tests)
- `resource.booking.test.js` — Resource booking, capacity validation, 409 conflict, and slot finder exclusion tests (9 tests)
- `resourceGraphColoringService.test.js` — Graph coloring interval edges, back-to-back non-overlap, deterministic palette sorting, greedy allocation, color blocking, and timezone invariance tests (11 tests)
- `resource.autoAllocate.routes.test.js` — Auto-allocation route tests, 400 validation, slot/suggestion resource assignment, and manual fallback compatibility tests (5 tests)
- `auth.routes.test.js` — Auth endpoints integration tests
- `event.routes.test.js` — Event CRUD endpoints integration tests
- `conflictDetectionService.test.js` — Scheduling conflict service unit tests (22 tests)
- `minHeapService.test.js` — MinHeap unit tests (push, pop, peek, custom comparator) (4 tests)
- `slotScoringService.test.js` — Slot heuristic scoring and heap ranking tests (12 tests)
- `segmentTreeService.test.js` — Discrete time bucket Segment Tree interval availability tests (10 tests)
- `availableSlotService.test.js` — Available slot discovery with SegmentTree tests (20 tests)
- `backtrackingSchedulingService.test.js` — Constraint relaxation and backtracking scheduling tests (16 tests)
- `participantAvailabilityService.test.js` — Participant email normalization, deduplication, case-insensitive lookup, and organizer inclusion unit tests (14 tests)
- `trieService.test.js` — Custom Trie insert, BFS prefix search, limit, and deduplication unit tests (7 tests)
- `participant.routes.test.js` — Participant search endpoint validation, auth, organizer exclusion, and cache refresh integration tests (7 tests)
- `scheduling.routes.test.js` — Scheduling conflict API route integration tests with real MongoDB (12 tests)
- `scheduling.slots.routes.test.js` — Scheduling available slots, preferences, and multi-participant availability API route integration tests with real MongoDB (20 tests)
- `scheduling.suggestions.routes.test.js` — Scheduling constraint relaxation, smart suggestions, and multi-participant availability route integration tests with real MongoDB (12 tests)
- `meeting.routes.test.js` — Shared meeting confirmation, invitations inbox, attendee RSVP, and organizer cancellation route integration tests (14 tests)
- `transactionSchedulingService.test.js` — Replica-set detection, write-conflict locking, calendar/booking version increments, concurrency isolation, and 503 fail-closed tests (12 tests)
- `timezoneService.test.js` — Timezone conversions, IANA validation, and wall-clock time getters tests (7 tests)

- `meeting.audit.routes.test.js` — Audit regressions: invitation-aware conflict checks, atomic meeting-move re-check, read-only cancelled meetings, email-only invitation spoofing (5 tests)
- `socket.realtime.test.js` — Socket.io cookie authentication, Origin allow-list, token expiry disconnect, per-user scoping of meeting/invitation/event events, rolled-back writes emit nothing, resource broadcasts without private data (14 tests)
- `realtime.unit.test.js` — Cookie parsing, origin allow-list, recipient derivation, room targeting (5 tests)

Phase M:
- `notificationRules.test.js` — Recipients, wording, dedupe keys, lead-time formatting, due-reminder selection (11 tests, pure)
- `redisConfig.test.js` — `REDIS_URL` validation, TLS for `rediss://`, prefix safety, sweep interval floor (6 tests, pure)
- `schedulingEvents.changes.test.js` — Which meeting edits count as attendee-relevant changes (3 tests, pure)
- `notification.processors.test.js` — Job processor and reminder sweep against MongoDB: recipients, retry idempotency, RSVP, declined/cancelled handling, deleted-meeting snapshot, lead times, pending invitees, reschedule (9 tests)
- `notification.routes.test.js` — Auth, per-user scoping, id cursor pagination without gaps, unread filter, mark read / read-all, preference validation, TTL and unique indexes (8 tests)
- `queue.integration.test.js` — Real Redis + BullMQ + MongoDB + HTTP + Socket.io: invitation, RSVP, reschedule vs description-only edit, deletion, job options, reminder scheduler, watchdog recovery after Redis data loss, Redis unreachable (8 tests)

Phase N and fixes:
- `geminiClient.test.js` — config defaults and validation, key only in a header, JSON mode and minimal thinking, fallback on 503, two-pass busy retry, no second pass after a timeout, thinking-level retry, no fallback on config errors, timeout → 504, network errors, unreadable or blocked answers (11 tests, fake `fetch`)
- `schedulingRequestParser.test.js` — text limits, prompt contents, UTC/local conversion, offsets, matched/ambiguous/not-found people, defaults, garbage and past windows, 31-day cap, duration clamps, preference/resource validation, dropped extra fields, title fallback, the full pipeline, the resolver's exact-match preference, the rate limiter (16 tests, pure)
- `assistant.routes.test.js` — auth, disabled without a key (503), stored timezone used, people resolved against real accounts and the requester excluded, no user data sent to the model, validation before any model call, 422/503/500 handling without leaking internals, 10/min limit per user with `Retry-After`, status (8 tests)
- `auth.timezone.test.js` — the browser timezone is stored at sign-up, invalid or missing → UTC, `PATCH /api/auth/me` validation and auth (4 tests)

Total (2026-11-21): 426 backend tests passing across 46 test files (run against MongoDB Atlas).

### Frontend Testing

Frontend uses Vitest, React Testing Library, and `@testing-library/user-event`.
Test files are located alongside components and pages in `frontend/src/`:

- `HomePage.test.jsx` (4 tests)
- `LoginPage.test.jsx` (2 tests)
- `RegisterPage.test.jsx` (2 tests)
- `AuthCallbackPage.test.jsx` (3 tests)
- `ProtectedRoute.test.jsx` (2 tests)
- `ParticipantPicker.test.jsx` (7 tests — covers min-length debounce, loading/empty states, chip addition, deduplication, chip removal, and full keyboard navigation)
- `DashboardPage.test.jsx` (21 tests — covers event CRUD, conflict detection, available slot finder, preference toggling, score badges, smart suggestions, relaxation notice, multi-participant coordination, participant autocomplete chip selection, and click-to-fill; renders the `/dashboard/*` route tree at the relevant page through `test/renderDashboard.jsx` and follows real navigation between pages)
- `DashboardResources.test.jsx` (8 tests — covers active resource listing, resource creation, soft-deactivation, event creation with resource, 409 conflict error rendering, slot discovery with resource badges, auto-allocate toggle, resourceType payload dispatch, and mutual exclusivity validation)
- `DashboardMeetings.test.jsx` (6 tests — covers invitations inbox rendering, RSVP accept/decline action triggers, shared meeting confirmation with participant/resource, organizer cancellation UI, and 503 replica-set error notification)
- `timezone.test.js` (5 tests — covers IANA timezone validation, datetime-local conversion, UTC ISO generation, and formatted display)
- `calendarLayout.test.js` (9 tests — covers week start and date-key arithmetic, timezone conversion, overlap column layout and conflict flags, week building with cancelled-event filtering and hour-range expansion, event kind classification, and upcoming-conflict detection)

- `useRealtimeUpdates.test.jsx` (6 tests — single subscription, no duplicate listeners, cleanup, reconnect resync, expiry)
- `DashboardRealtime.test.jsx` (9 tests — live invitations, in-place event/meeting/resource updates, stale slot results with Search again, resync, expiry, duplicate-push race)
- `apiClient.test.js` (5 tests — credentials, JSON errors, non-JSON errors, network failure, 204)

- `DashboardNotifications.test.jsx` (13 tests — unread badge, panel contents, live push, duplicate push, reminder on status line, click marks read and opens Events, mark all read, cross-tab read sync, reminder preference, paused-delivery notice, Escape/focus, failed load, reconnect refetch)
- `relativeTime.test.js` (2 tests)
- `DashboardAssistant.test.jsx` (8 tests — hidden without a key, enable rules, interpretation summary, ambiguous choice, fill-only, search with exact parsed values, unresolved names left out, error display, Enter vs Shift+Enter)
- `TimezoneSettings.test.jsx` (3 tests — sign-up sends the browser zone, one-click switch updates the account, sidebar and composer, no button when the zones match)

Unit tests never open real sockets: `src/test/setup.js` mocks `createRealtimeSocket` with `src/test/fakeRealtimeSocket.js`.

Total: 116 frontend tests passing across 18 test files (2026-11-21).

### End-to-End Testing

Playwright tests are in `frontend/e2e/`. Playwright starts its own backend (`:5100`) and Vite (`:5180`) against `conflictfree_e2e`, which `e2e/globalSetup.js` resets before each run (Decision 42). Any server already on `:5000` or `:5173` is left alone.

- `realtime.spec.js` (1 test): two browser contexts (two users). Invitation, acceptance, cancellation, and a new room each reach the other user's open dashboard without a reload.
- `notifications.spec.js` (2 tests, Phase M): (1) two users — invitation, RSVP and cancellation notifications arrive through BullMQ and Socket.io, and "Mark all as read" persists across a reload; (2) a reminder arrives from the background sweep with no user action, and the reminder lead time persists.

- `assistant.spec.js` (1 test, Phase N): through the real Gemini API, a sentence is parsed, the named person is resolved to their real account, "Search these times" returns ranked slots, and picking one opens the composer with the parsed title, ready to "Confirm shared meeting". It retries up to 3 times if the UI reports Gemini as busy.

Phase M settings for the E2E backend: `REDIS_URL` (`E2E_REDIS_URL`, default `redis://127.0.0.1:6379`), `BULLMQ_PREFIX=cfe2e`, `REMINDER_SWEEP_INTERVAL_MS=2000`. `globalSetup` deletes all `cfe2e:*` keys and refuses any prefix not ending in `e2e`. Playwright starts the web servers before `globalSetup`, so that reset also removes the backend's reminder scheduler; the watchdog restores it within about 6s, which the reminder test exercises on every run.

- `foundation.spec.js` (13 tests):
  - Frontend/backend health connection
  - 404 route handling
  - Google auth error handling
  - User registration, event create/edit/delete, logout, and login
  - Scheduling conflict detection blocking event creation, displaying conflict warnings, and allowing creation after time change
  - Available slot search within a window, filtering busy blocks, and clicking a slot to create an event
  - Preference-based slot scoring and Min-Heap ranking with score badges and reason tags, selecting top-ranked slot to create event
  - Smart suggestions multi-level constraint relaxation when preferred window is blocked, displaying relaxation notice, and populating event form on selection
  - Multi-participant availability discovery excluding participant busy periods and populating event form
  - Trie-based participant search and autocomplete coordinates availability and populates event form on selection
  - Shared resource creation, booking, conflict detection across separate users, back-to-back booking, and slot availability exclusion flow
  - Automatic shared resource allocation with Graph Coloring assigning free resources, adapting to overlapping bookings, and populating event form on selection
  - Shared meeting confirmation with participants and resource, invitation inbox RSVP response, and organizer cancellation flow with atomic updates