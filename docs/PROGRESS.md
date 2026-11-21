# ConflictFree Progress

## Completed

### Project Foundation

- Backend Node/Express app created.
- Frontend React/Vite app created.
- Backend health route added.
- Frontend health check added.
- Backend tests configured.
- Frontend tests configured.
- Playwright e2e configured.

### MongoDB

- Local MongoDB Community Server installed.
- `mongosh` verified.
- Backend MongoDB connection verified.
- Database `conflictfree` created through actual app usage.
- `users` collection verified.
- `events` collection verified through event CRUD usage.

### Authentication Backend

- User model created.
- Google OAuth login implemented.
- Google OAuth callback implemented.
- Google profile fetching implemented.
- Manual register implemented.
- Manual login implemented.
- Password hashing implemented with bcrypt.
- JWT signing/verifying implemented.
- JWT stored in HTTP-only cookie.
- Logout clears auth cookie.
- `/api/auth/me` implemented.
- Auth middleware implemented.
- Backend auth tests passing.

### Authentication Frontend

- Login page created.
- Register page created.
- Google login link added.
- Auth callback page created.
- AuthContext created.
- ProtectedRoute created.
- Dashboard page created.
- Home page shows authenticated user.
- Logout works.
- Frontend auth tests passing.
- E2E manual auth flow passing.

### Real Auth Verification

- Real Google OAuth credentials configured.
- Google test user added.
- Real Google login verified.
- Real MongoDB persistence verified.
- Manual register/login verified.

### Event Backend

- Event model created.
- Event participants schema created.
- Event create route implemented.
- Event list route implemented.
- Event get-by-id route implemented.
- Event update route implemented.
- Event delete route implemented.
- Event routes protected with authentication.
- Event queries scoped to authenticated user.
- Event validation implemented.
- Backend event model tests passing.
- Backend event route tests passing.
- Manual event CRUD API testing completed.

### Event Frontend

- Event service created.
- Dashboard event list implemented.
- Dashboard event create form implemented.
- Dashboard event edit/update implemented.
- Dashboard cancel edit implemented.
- Dashboard event delete implemented.
- Dashboard event tests passing.
- Event create/edit/delete e2e passing.

### Scheduling / Conflict Detection Engine (Phase A)

- Scheduling service created (`conflictDetectionService.js`) with time range normalization, open-interval overlap detection, and query builder.
- Self-conflict exclusion supported via `excludeEventId`.
- Scheduling controller created (`schedulingController.js`).
- Scheduling router created (`schedulingRoutes.js`) with `POST /api/scheduling/conflicts`.
- Scheduling routes mounted in Express app under `/api/scheduling`.
- Backend unit tests created (`conflictDetectionService.test.js` - 22/22 passing).
- Backend integration route tests created (`scheduling.routes.test.js` - 12/12 passing).
- Frontend scheduling service created (`schedulingService.js`).
- Dashboard updated with pre-submit conflict check and animated conflict warning alert listing overlapping meeting details.
- Save blocking on conflict implemented with auto-clear on time field change.
- Conflict warning styles added to `App.css`.
- Frontend unit tests updated (`DashboardPage.test.jsx` - 7/7 passing).
- Playwright E2E conflict test added (`foundation.spec.js` - 5/5 passing).

### Scheduling / Available Slot Finder (Phase B)

- Available slot service created (`availableSlotService.js`) with window search normalization, busy range calculation, candidate slot generation, and non-overlap filtering.
- Controller updated with `findSlots` handler (`schedulingController.js`).
- Route `POST /api/scheduling/available-slots` added to `schedulingRoutes.js`.
- Backend unit tests created (`availableSlotService.test.js` - 20/20 passing).
- Backend integration route tests created (`scheduling.slots.routes.test.js` - 10/10 passing).
- Frontend `schedulingService.js` updated with `findAvailableSlots`.
- Dashboard UI updated with "Find available slots" panel with interactive inputs, slot listing, click-to-fill form interaction, and empty/error states.
- CSS added for slot finder panel, results list, slot pill buttons, and responsive column layout in `App.css`.
- Frontend unit tests updated (`DashboardPage.test.jsx` - 11/11 passing).
- Playwright E2E test added for available slot finding and slot-based event creation (`foundation.spec.js` - 6/6 passing).

### Scheduling / Slot Scoring & Min-Heap Ranking (Phase C)

- Custom `MinHeap` class implemented from scratch (`minHeapService.js`) supporting generic priority comparators.
- Slot scoring service implemented (`slotScoringService.js`) with input normalization, heuristic rule evaluation (+30 preferred hours, -15/+5 early morning, -10/+5 late day, earliest slot bonus), 0-100 score clamping, and human-readable reason explanations.
- Min-Heap best-first slot ranking (`rankSlots`) integrated with available slot discovery (`availableSlotService.js`).
- Backend unit tests created (`minHeapService.test.js` - 4/4 passing, `slotScoringService.test.js` - 12/12 passing).
- Backend route integration tests created (`scheduling.slots.routes.test.js` - 13/13 passing with preferences and isolated test owner IDs).
- Frontend `schedulingService.js` updated with preferences parameter.
- Dashboard UI updated with "Preferences & Ranking (Optional)" configuration inputs, styled score badges (`Score: 85`), and readable reason pills on ranked slot items.
- CSS styles added for preference fieldset, checkbox group, score badges, and reason tags in `App.css`.
- Frontend unit tests updated (`DashboardPage.test.jsx` - 12/12 passing).
- Playwright E2E test added for slot scoring, preference ranking, and event creation (`foundation.spec.js` - 7/7 passing).

### Scheduling / Timezone Consistency Architecture

- Created shared backend timezone utility service (`backend/src/services/timezoneService.js`) and frontend utility (`frontend/src/utils/timezone.js`) using `date-fns-tz` for DST-safe conversions.
- Made `User.timezone` from MongoDB the single authoritative source of truth for user-facing wall-clock times and scheduling preference evaluation.
- Stored all event timestamps as absolute UTC instants in MongoDB and transport payloads.
- Updated `slotScoringService.js` to evaluate candidate slot start/end wall-clock hours in the user's timezone instead of UTC hours.
- Updated `schedulingController.js` to resolve the user's authoritative timezone from database and pass to slot search and scoring.
- Updated `DashboardPage.jsx` to parse and render all `datetime-local` inputs and display formatted times using the user's configured timezone without system timezone drift.

### Scheduling / Discrete Time Segment Tree (Phase D)

- Implemented discrete time bucket `SegmentTree` class from scratch (`backend/src/services/scheduling/segmentTreeService.js`) using an array-based binary tree of size `4 * N` over `N` discrete buckets of resolution `stepMinutes`.
- Range registration `addBusyRange` and range vacancy query `isRangeFree` operating in $O(\log N)$ time with exact boundary semantics allowing back-to-back meetings.
- Integrated `SegmentTree` into `availableSlotService.js` to accelerate slot vacancy testing.
- Created unit tests (`backend/tests/segmentTreeService.test.js` - 10/10 passing).

### Scheduling / Backtracking Constraint Relaxation & Smart Suggestions (Phase E)

- Implemented constraint relaxation engine (`backend/src/services/scheduling/backtrackingSchedulingService.js`):
  - Input normalization with `minimumScore` (0–100) and `maxSuggestions` validation.
  - 5-level deterministic relaxation hierarchy (Level 0 Strict through Level 4 All Relaxed).
  - Multi-level search with early exit on first qualifying level, score deduction based on relaxed constraints, and fallback to Level 4 conflict-free slots.
- Added controller handler `suggestSlots` in `schedulingController.js` and route `POST /api/scheduling/suggestions` in `schedulingRoutes.js`.
- Created backend unit tests (`backend/tests/backtrackingSchedulingService.test.js` - 16/16 passing).
- Created route integration tests (`backend/tests/scheduling.suggestions.routes.test.js` - 10/10 passing).
- Added `findSmartSuggestions` to frontend `schedulingService.js`.
- Added Smart Suggestions UI to `DashboardPage.jsx`: Minimum score & Max suggestions inputs, "Find smart suggestions" button, suggestion cards with score badges/reasons/relaxed constraints chips, relaxation notice banner with constraint labels, and click-to-populate event form behavior.
- Added styling for relaxation notice, relaxation chips, and constraint tags in `App.css`.
- Updated frontend unit tests (`DashboardPage.test.jsx` - 16/16 passing, total frontend 34/34 passing).
- Added Playwright E2E test for smart suggestions relaxation and event creation (`foundation.spec.js` - 8/8 passing).

### Scheduling / Trie-Based Participant Search & Autocomplete (Phase G)

- Custom zero-dependency `Trie` implementation built from scratch (`backend/src/services/search/trieService.js`):
  - In-memory node structure with character-keyed children and safe participant maps.
  - Multi-token indexing: indexes full names, individual name words, full emails, and email usernames for comprehensive prefix discovery.
  - Breadth-First Search (BFS) subtree traversal ensuring nearest/shortest matches rank ahead of distant matches.
  - Case-insensitive search with automatic deduplication by user ID across multiple matching tokens.
  - Configurable result limits (default 10, clamped between 1 and 20).
  - Strict privacy: only returns safe participant fields (`id`, `name`, `email`, `timezone`), never indexing or returning sensitive credentials (`passwordHash`, `googleId`, tokens, events).
  - Note: The Trie currently indexes registered participant names and emails for autocomplete. Extending the Trie to index shared resources and calendar events remains future work.
- Participant search service (`backend/src/services/search/participantSearchService.js`):
  - Validates search query (minimum 2 non-whitespace characters) and limits (integer between 1 and 20).
  - Excludes the authenticated organizer from search results so users cannot select themselves.
  - Invalidation-on-write caching strategy: lazily builds the Trie from MongoDB on first query, and automatically invalidates the cache (`invalidateParticipantSearchCache()`) whenever a user registers or logs in via Google in `authService.js`.
- Protected search API route:
  - Mounted `GET /api/participants/search?q=<prefix>&limit=10` under `/api/participants` protected by `requireAuth`.
  - Rejects missing, short, or invalid queries with HTTP 400.
  - Rejects invalid limit parameters with HTTP 400.
  - Returns HTTP 200 with `{ success: true, participants: [...] }`.
- Frontend participant search service (`frontend/src/services/participantSearchService.js`):
  - Encapsulates `searchParticipants(query, limit, signal)` with request abort support.
- Reusable `ParticipantPicker` component (`frontend/src/components/ParticipantPicker.jsx`):
  - Search begins only after typing 2 characters with 300ms debounce.
  - Clear loading indicator, no-result message, and error state.
  - Full keyboard accessibility: ArrowDown/ArrowUp cycle through suggestions, Enter selects highlighted item, and Escape closes dropdown.
  - Selected participant chips with accessible Remove action button (`aria-label="Remove <name>"`).
  - Duplicate participant selection prevention.
  - Organizer exclusion prevention on both backend and client side.
  - Backward-compatible support for direct email entry and paste.
- Integrated `ParticipantPicker` on `DashboardPage.jsx`:
  - Replaced comma-separated text input with `<ParticipantPicker>`.
  - Shared participant selection state across both Available Slots and Smart Suggestions workflows.
  - Sends selected participant emails as `participantEmails: ["email1@example.com", ...]` to existing Phase F endpoints.
  - Styled with responsive, polished CSS in `App.css`.
- Test suites:
  - Backend Trie unit tests (`backend/tests/trieService.test.js` - 7/7 passing).
  - Backend search route integration tests (`backend/tests/participant.routes.test.js` - 7/7 passing).
  - Frontend component unit tests (`frontend/src/components/ParticipantPicker.test.jsx` - 7/7 passing).
  - Frontend integration tests in `DashboardPage.test.jsx` for slot finder and smart suggestions payload dispatch (21/21 passing).
  - Playwright E2E test added for participant autocomplete, chip addition, slot search, and event creation (`foundation.spec.js` - 10/10 passing).

### Shared Resources, Room Booking, and Resource Availability (Phase H)

- Shared Resource Data Model (`backend/src/models/Resource.js`):
  - Stores `name` (unique case-insensitive index), `type` (`"room"` | `"equipment"`), `capacity` (integer $\ge 1$), `location`, `description`, `isActive` (default true), and `createdBy` (User ref).
- Event Schema Extension (`backend/src/models/Event.js`):
  - Added optional `resource` ObjectId ref with compound indexes `{ resource: 1, startAt: 1 }` and `{ resource: 1, endAt: 1 }`.
- Resource Service & Controller (`backend/src/services/resourceService.js`, `backend/src/controllers/resourceController.js`):
  - Implements CRUD with creator authorization (HTTP 403 Forbidden on update/delete for non-creators) and case-insensitive unique name validation (HTTP 400).
  - Soft deactivation on `DELETE /api/resources/:id` (`isActive: false`) preserving event references.
  - Mounted at `/api/resources` (`backend/src/routes/resourceRoutes.js`).
- Resource Availability Engine (`backend/src/services/resourceAvailabilityService.js`):
  - `validateResourceForBooking`: checks resource exists, is active (400), satisfies capacity (400), and validates that no conflicting booking exists in open intervals ($O(1)$ query excluding the event being updated).
  - Throws HTTP 409 Conflict with generic message `"Resource is already booked for the requested time"`, protecting details of other users' events.
  - Allows back-to-back bookings where boundaries touch.
  - `findResourceBusyRanges`: queries resource busy intervals for scheduling engines.
- Integration into Event CRUD & Scheduling Engines:
  - `eventController.js` validates resource availability on `createEvent` and `updateEvent`, populating resource metadata in responses.
  - `availableSlotService.js` and `backtrackingSchedulingService.js` accept `additionalBusyRanges` from `findResourceBusyRanges` and insert them into the `SegmentTree` along with participant busy intervals.
  - Responses return safe `resource` summary `{ id, name, type, capacity }`.
- Frontend Services, Components & UI (`DashboardPage.jsx`):
  - Frontend resource service (`frontend/src/services/resourceService.js`).
  - Added "Shared Resources" panel to create, list, edit, and deactivate active resources.
  - Event form includes "Book resource" selector and "Expected attendees" input.
  - Slot Finder includes "Required resource (Optional)" selector and "Required attendees" input.
  - Results display selected slot resource badge and auto-fill resource into the event form on slot/suggestion selection.
  - Event cards display assigned resource badges.
- Test suites:
  - Backend Resource model tests (`backend/tests/resource.model.test.js` - 5/5 passing).
  - Backend Resource routes integration tests (`backend/tests/resource.routes.test.js` - 8/8 passing).
  - Backend Resource booking & availability integration tests (`backend/tests/resource.booking.test.js` - 9/9 passing).
  - Frontend Resource unit & integration tests (`frontend/src/pages/DashboardResources.test.jsx` - 5/5 passing).
  - Playwright E2E test added for resource creation, cross-user booking, 409 conflict detection, back-to-back booking, and slot availability exclusion (`foundation.spec.js` - 11/11 passing).

### Graph-Coloring-Based Automatic Resource Allocation (Phase I)

- Custom Graph Coloring Algorithm & Service (`backend/src/services/scheduling/resourceGraphColoringService.js`):
  - Formulates an interval conflict graph where candidate meeting is an uncolored vertex adjacent to existing confirmed bookings overlapping in open intervals ($start_1 < end_2 \land end_1 > start_2$).
  - Confirmed bookings have fixed colors equal to their assigned resource ID and are never recolored.
  - Active resources matching capacity ($\ge attendeeCount$) and optional resource type filter form the palette.
  - Greedy coloring order deterministically sorted by resource `name` ascending, then `_id` ascending.
  - Discards candidate slots where no compatible resource can be allocated.
  - Returns safe resource summary (`{ id, name, type, capacity, location }`) and descriptive `allocationReason`.
  - Zero-leakage privacy: never queries or exposes private properties of other users' events.
- Scheduling Integration:
  - `availableSlotService.js` and `backtrackingSchedulingService.js` accept `autoAllocateResource`, `resourceType`, and `attendeeCount`.
  - `POST /api/scheduling/available-slots` and `POST /api/scheduling/suggestions` enforce mutual exclusivity between `resourceId` and `autoAllocateResource` (HTTP 400).
- Frontend UI (`frontend/src/pages/DashboardPage.jsx`):
  - Added "Automatically allocate a resource" checkbox in Slot Finder.
  - Mutual exclusivity in UI: checking auto-allocation disables and clears manual resource selector.
  - Added "Resource type preference" selector (Any type / Room / Equipment).
  - Available slot pills and smart suggestion cards render allocated resource badge and reason string.
  - Clicking any auto-allocated slot or suggestion populates the Event form with the chosen resource ID, attendee count, and start/end times.
- Test suites:
  - Backend Graph Coloring unit tests (`backend/tests/resourceGraphColoringService.test.js` - 11/11 passing).
  - Backend Auto-Allocate routes integration tests (`backend/tests/resource.autoAllocate.routes.test.js` - 5/5 passing).
  - Frontend Auto-Allocate unit & integration tests (`frontend/src/pages/DashboardResources.test.jsx` - 8/8 passing).
  - Playwright E2E test added for automatic resource allocation, multi-room greedy coloring under busy conditions, and event form populating (`foundation.spec.js` - 12/12 passing).
- Scheduling Phase J (Shared Meeting Confirmation and Invitations):
  - Canonical Shared Meeting Data Model (`Event.js`) with embedded `participants` array (`user`, `email`, `name`, `status`, `respondedAt`) and top-level meeting `status` (`"active"` | `"cancelled"`).
  - High-performance compound indexes: `{ status: 1 }`, `{ "participants.user": 1, startAt: 1 }`, `{ "participants.email": 1, startAt: 1 }`, and `{ "participants.user": 1, "participants.status": 1 }`.
  - Best-effort concurrency protection on standalone MongoDB: pre-flight conflict rechecks across participants and reserved resources immediately before meeting creation and RSVP acceptance.
  - Protected API routes:
    - `POST /api/meetings/confirm`: Confirms shared meeting with registered participants, optional resource reservation, and pending invitations.
    - `GET /api/meetings/invitations`: Pending invitations inbox for authenticated users.
    - `PATCH /api/meetings/:id/invitation-response`: Allows invitee to accept or decline. Accepts trigger conflict rechecks.
    - `POST /api/meetings/:id/cancel`: Organizer-only meeting cancellation releasing participant and resource availability.
  - Availability queries exclude cancelled meetings and match pending or accepted invitations, while declined invitations do not block future slot availability.
  - Frontend UI: "Pending invitations" inbox with Accept/Decline buttons, "Confirm shared meeting" button, meeting status badges, participant RSVP chips, and organizer meeting cancellation.
  - Test suites:
    - Backend Meeting routes integration tests (`backend/tests/meeting.routes.test.js` - 14/14 passing).
    - Frontend Meeting unit & integration tests (`frontend/src/pages/DashboardMeetings.test.jsx` - 6/6 passing).
    - Playwright E2E test added for shared meeting confirmation, invitation inbox RSVP, and organizer cancellation flow (`foundation.spec.js` - 13/13 passing).

### Scheduling Phase K (MongoDB Replica Set and True Atomic Booking)

- Local MongoDB Community Server Replica Set Configuration:
  - Audited local MongoDB deployment: `mongod.exe` at `C:\Program Files\MongoDB\Server\8.2\bin`, data at `C:\Program Files\MongoDB\Server\8.2\data`, port 27017.
  - Configured `replSetName: rs0` in `mongod.cfg` and restarted Windows service `MongoDB`.
  - Initiated single-node replica set via `rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })`.
  - Verified `db.hello().setName` returns `rs0`.
  - Configured `MONGODB_URI=mongodb://127.0.0.1:27017/conflictfree?replicaSet=rs0` in `backend/.env` and `backend/.env.example`.
- Concurrency & Write-Conflict Locking Engine (`transactionSchedulingService.js`):
  - Solves the phantom overlap window vulnerability in MongoDB transactions by implementing write-conflict row locks.
  - Added `calendarVersion` field to `User` schema (default 0).
  - Added `bookingVersion` field to `Resource` schema (default 0).
  - Canonical sorted ObjectId locking order (`lockUsersInOrder`, `lockResourcesInOrder`) eliminates deadlocks.
  - Concurrent overlapping transactions trigger write-conflicts on participants or resources, forcing clean abort, re-read of availability, and HTTP 409 Conflict.
  - `withSchedulingTransaction` starts sessions and manages transactions with retry logic.
  - Fail-closed detection: `isTransactionSupported` inspects `db.admin().command({ hello: 1 })`. Standalone MongoDB deployments immediately reject transactions with HTTP 503 (`"Atomic scheduling requires a MongoDB replica set."`) without silent dirty writes.
- End-to-End Transactional Coverage:
  - `POST /api/meetings/confirm`: Confirms shared meetings inside a replica-set transaction, atomically locking participants and resources.
  - `PATCH /api/meetings/:id/invitation-response`: Atomically locks participant, re-checks conflict, and commits response inside transaction.
  - `POST /api/meetings/:id/cancel`: Atomically locks participants and resource and marks status cancelled inside transaction.
  - Personal Event CRUD (`/api/events`): Create/update/delete reserving or modifying resources executes inside replica-set transaction. Non-resource personal events continue to operate without transaction overhead.
- Frontend Error Handling:
  - `DashboardPage.jsx`: Renders an actionable alert when encountering HTTP 503 replica-set error.
- Comprehensive Test Coverage:
  - `backend/tests/transactionSchedulingService.test.js`: 12/12 passing tests covering replica-set detection, 503 fail-closed behavior, canonical lock ordering, rollback on concurrent participant/resource conflicts, concurrency isolation, and personal event compatibility.
  - `frontend/src/pages/DashboardMeetings.test.jsx`: Test 6 verifies actionable 503 replica-set warning banner.

### Pre-Phase-L Audit (2026-11-18)

Environment on this machine (`D:\New folder\conflictfree-scheduler\conflictfree-scheduler`, Node v26.12.1):
- MongoDB was not installed. A portable MongoDB Community Server 8.2.12 (official zip, SHA-256 verified) was set up at `D:\mongodb`, config `D:\mongodb\mongod.cfg`, data `D:\mongodb\data\rs0`, running as single-node replica set `rs0` on `127.0.0.1:27017`. It is a normal process, not a Windows service. Start it with `D:\mongodb\server-8.2.12\bin\mongod.exe --config D:\mongodb\mongod.cfg`.
- Playwright Chromium had to be installed (`npx playwright install chromium`).

Measured baseline before changes: backend 306/306 and E2E 13/13 once MongoDB was available. Frontend 46/60: 13 failures because Node 25+'s built-in `localStorage` global shadows jsdom's storage, plus 1 timing flake.

Fixes (each with regression tests):
- **Destructive tests:** backend tests wiped the development database. They now run on a dedicated `*_test` database with a safety guard (Decision 31).
- **Participant spoofing:** `/api/events` accepted arbitrary `participants`, and inbox/visibility matched by free-text email. Both now use only the verified user id (Decision 32).
- **Conflict check gaps:** conflict checks ignored accepted/pending invitations. Moving a shared meeting did not re-check participants. Cancelled meetings were editable (Decision 33).
- **Google OAuth:** login requested calendar scope, had no CSRF `state` check, and linked unverified emails (Decision 34).
- **Error handling:** HTML error pages and possible stack leakage. There is now a central JSON error handler, a JSON 404, a structured redacting logger, and a pinned JWT algorithm (Decision 35).
- **Duplicated logic:** availability query logic was duplicated in four services. It is now in `calendarQueryService.js`.
- **Frontend tests:** a Node 26 storage shim in `src/test/setup.js`. An auth race where a slow initial `/api/auth/me` 401 could log out a user who had just signed in, fixed in `AuthContext.jsx`.

Audit items that depended on the frontend restructure:
- **Done (2026-11-18, frontend redesign):** removed the obsolete "Participant email / Participant name" fields; personal events no longer send `participants` (Decision 40).
- **Done (Phase L):** `apiClient.js` now handles non-JSON responses, 204 responses, and network failures. Errors carry `status` (`apiClient.test.js`).

### Phase L: Socket.io Real-time Updates (complete, 2026-11-18)

- `socket.io@4.8` server: cookie-only authentication, Origin allow-list, private per-user rooms, expiry disconnect, graceful shutdown (Decisions 36 and 37).
- Domain-event publishing after commit (`services/schedulingEvents.js`) for meetings, invitations, RSVPs, cancellations, events, and resources.
- Tests: `socket.realtime.test.js` (14) and `realtime.unit.test.js` (5), against a real HTTP server, real Socket.io, and the `rs0` replica set.
- Manual verification against `npm start`: register two users, connect sockets with real cookies, then confirm → accept → cancel. Each step delivered the expected events to the expected user only.
- Frontend:
  - `services/realtimeClient.js` connects same-origin through the Vite `/socket.io` proxy (`ws: true`) with the HTTP-only cookie. JavaScript never reads a token.
  - `hooks/useRealtimeUpdates.js` opens one socket per dashboard mount, with one listener per event. Handlers are read through refs, so re-renders never add listeners. Unmount removes every listener and disconnects. A reconnect refetches events, invitations, and resources. `session:expired` or an auth rejection stops reconnecting and signs the user out.
  - `DashboardProvider` applies pushes in place: events and meetings are upserted or removed, invitations are refetched with a "New invitation: …" message, and the resource catalogue is upserted or removed. Pushed calendar or booking changes mark Find-a-time results "may be out of date", with a **Search again** button. Results are never re-run silently.
  - `AppShell` shows the connection state (Connecting… / Live / Reconnecting… / Offline).
  - Bug found by the two-user E2E test and fixed: a created event could appear twice when its push arrived before the HTTP response. All local create paths now upsert by id. A regression test reproduces that ordering.
- Tests:
  - `useRealtimeUpdates.test.jsx` (6): single subscription, no duplicate listeners, cleanup, reconnect resync, expiry.
  - `DashboardRealtime.test.jsx` (9): live inbox, in-place updates and deletes, cancellation, stale results with Search again, resource catalogue, resync, expiry, duplicate-push race.
  - `apiClient.test.js` (5).
  - `e2e/realtime.spec.js`: two browser contexts. The invitee sees the invitation, the organizer sees the acceptance, the invitee sees the cancellation, and the invitee sees a new room, all without reloading.
- E2E isolation: Playwright now starts its own backend on :5100 and frontend on :5180 (`reuseExistingServer: false`), against `conflictfree_e2e`. `e2e/globalSetup.js` resets that database before every run and refuses to drop any database not ending in `_e2e`. Before this, E2E wrote into the development database and could silently reuse a stale dev server.
- Known issue: the two-user E2E test failed twice in about 22 runs on 2026-11-18. Both failures were `toHaveURL('/dashboard')` timeouts right after registration, early in the session. It then passed 18 consecutive times (5 cold starts, 10 repeats, 3 full runs). The root cause is not confirmed; a Vite dependency re-optimisation reload is suspected. `trace: "retain-on-failure"` is enabled so the next occurrence is captured. No retries are configured, so it is not hidden.

### Frontend Redesign & Dashboard Split (2026-11-18)

- Approved design: the "ConflictFree Redesign" design canvas artifact (Overview, New event, Find a time, Rooms & equipment, Sign in, Foundations).
- Design system "Instrument" implemented in `App.css` tokens, with Geist and Geist Mono fonts, a brand favicon, and inline SVG icons (Decision 38).
- Public pages restyled: Home, Sign in, Register, 404, and the OAuth callback. The callback page no longer stores derived state in an effect, which fixes its existing lint error.
- `DashboardPage.jsx` replaced by `/dashboard/*` nested routes (Decision 39):
  - `AppShell` sidebar layout with a global status line and a "New event" action, collapsing to a top bar on phones.
  - Overview: week calendar (`WeekCalendar.jsx` + `utils/calendarLayout.js`) with side-by-side overlap rendering, a "Needs a decision" card for upcoming overlaps, the invitations inbox, and rest of today.
  - Events: event rows with edit, delete, cancel meeting, and RSVP actions.
  - New event: grouped composer (When / People / Where), inline conflict alert, live checks panel.
  - Find a time: constraint panel plus ranked result rows with score bars, tabs when both search types have run, and selecting a row opens the filled composer.
  - Rooms & equipment: resource list plus create/edit form.
- Personal events no longer carry participants. Picking people switches the composer to "Confirm shared meeting" (Decision 40).
- Tests:
  - New `utils/calendarLayout.test.js` (9 tests).
  - Dashboard tests now render the route tree through `test/renderDashboard.jsx`. Changes were limited to starting routes, waiting on the status line or a select option instead of list text, a named combobox query, the "Scheduling conflict detected" text without the emoji, and adding participants through the picker.
  - E2E: added navigation helpers. Class hooks and 24-hour slot-time assertions were updated.
  - The register/create test no longer adds a participant to a personal event. That path was already failing against the backend rule above.
  - The graph-colouring test now checks the kind of kit allocated (Beta at 10:00, Alpha at 11:00) instead of this run's exact record, because resources from earlier runs remain in the shared database.
  - The trie test now confirms a shared meeting, because the picked participant carries over to the composer.
- Gate: frontend 70/70, lint clean apart from the existing `AuthContext.jsx` fast-refresh rule, `vite build` passes, E2E 13/13. Pages were also checked in screenshots at 1440px and 390px.

---

## Current Status

- Authentication is complete end-to-end.
- Event CRUD is complete end-to-end.
- Scheduling Phase A (Overlap Conflict Detection) is complete end-to-end.
- Scheduling Phase B (Available Slot Finder) is complete end-to-end.
- Scheduling Phase C (Slot Scoring and Ranking with Min-Heap) is complete end-to-end.
- Scheduling Phase D (Discrete Time Segment Tree) is complete end-to-end.
- Scheduling Phase E (Backtracking Constraint Relaxation & Smart Suggestions) is complete end-to-end.
- Scheduling Phase F (Multi-Participant Availability Discovery) is complete end-to-end.
- Scheduling Phase G (Trie-Based Participant Search & Autocomplete) is complete end-to-end.
- Scheduling Phase H (Shared Resources, Room Booking, and Resource Availability) is complete end-to-end.
- Scheduling Phase I (Graph-Coloring-Based Automatic Resource Allocation) is complete end-to-end.
- Scheduling Phase J (Shared Meeting Confirmation and Invitations) is complete end-to-end.
- Scheduling Phase K (MongoDB Replica Set and True Atomic Participant/Resource Booking) is complete end-to-end.
- Unified Timezone Consistency Architecture is complete end-to-end with full automated test coverage.
- Test results (2026-11-18, this machine):
  - Backend: 342/342 passing across 36 test files (`npm test`, `rs0` replica set, `conflictfree_test` database).
  - Frontend: 90/90 passing across 14 test files. Lint is clean except the existing `AuthContext.jsx` fast-refresh rule. `vite build` passes.
  - E2E: 14/14 passing (13 foundation + 1 two-user real-time), on isolated ports and the `conflictfree_e2e` database.
- Frontend redesign and dashboard split is complete (Decisions 38–40).
- Phase L (Socket.io real-time updates) is complete end-to-end (Decisions 36, 37, 41, 42).

---

## Next Feature

Planned next steps:
1. Phase M: Redis + BullMQ in-app notifications and reminders. Needs a Redis decision: Memurai, WSL Redis, or managed.
2. Phase N: Gemini natural-language parsing. Needs `GEMINI_API_KEY`.
3. Phase O: Google Calendar connection. Needs Google Cloud OAuth changes.
4. Phase P: benchmarks, hardening, and deployment docs.

---

## Deferred

- Docker.
- Redis.
- BullMQ.
- Gemini integration.
- Google Calendar sync.
- Production deployment.
- CSRF protection.
- Rate limiting.
- Forgot password.
- Email verification.
- Calendar-style month/week/day UI.
- Recurring events.