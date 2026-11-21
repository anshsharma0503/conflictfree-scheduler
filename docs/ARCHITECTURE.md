# ConflictFree Architecture

## Current Architecture

ConflictFree currently has two main applications:

```text
conflictfree-scheduler/
├─ backend/
├─ frontend/
└─ docs/
```

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
- `backend/src/server.js` loads environment variables, connects to MongoDB, creates a Node `http` server, attaches the Socket.io server (`realtime/socketServer.js`), and handles SIGINT/SIGTERM with a graceful shutdown (Socket.io → HTTP → MongoDB, with a 10s forced-exit fallback).

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

### Backend Folder Structure

```text
backend/src/
├─ config/
│  └─ database.js
├─ controllers/
│  ├─ authController.js
│  ├─ eventController.js
│  ├─ participantController.js
│  ├─ resourceController.js
│  └─ schedulingController.js
├─ middleware/
│  └─ requireAuth.js
├─ models/
│  ├─ Event.js
│  ├─ Resource.js
│  └─ User.js
├─ routes/
│  ├─ authRoutes.js
│  ├─ eventRoutes.js
│  ├─ participantRoutes.js
│  ├─ resourceRoutes.js
│  └─ schedulingRoutes.js
├─ services/
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

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET  /api/auth/google`
- `GET  /api/auth/google/callback`
- `GET  /api/auth/me`
- `POST /api/auth/logout`

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
├─ index.html                 # Loads Geist / Geist Mono from Google Fonts
├─ public/favicon.svg         # Brand mark
└─ src/
   ├─ components/
   │  ├─ AppShell.jsx         # Sidebar + top bar layout for /dashboard/*
   │  ├─ AuthAside.jsx        # Illustration panel on public pages
   │  ├─ BrandMark.jsx
   │  ├─ Icon.jsx             # Inline stroke-SVG icon set
   │  ├─ ParticipantPicker.jsx
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
   ├─ services/               # apiClient, auth, event, health, meeting,
   │                          # participantSearch, resource, scheduling
   ├─ test/
   │  ├─ renderDashboard.jsx  # Renders the /dashboard/* route tree in tests
   │  └─ setup.js
   ├─ utils/
   │  ├─ calendarLayout.js    # Week layout, overlap columns, upcoming conflicts
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
- Type: Geist for UI text, Geist Mono with tabular numbers for all times, dates, and counts.
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
`npm test` preloads `tests/helpers/testEnv.js`, which forces a dedicated `*_test` database (Decision 31).
Integration tests require the local `rs0` replica set.
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

Total (2026-11-18): 342 backend tests passing across 36 test files.

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

Unit tests never open real sockets: `src/test/setup.js` mocks `createRealtimeSocket` with `src/test/fakeRealtimeSocket.js`.

Total: 90 frontend tests passing across 14 test files (2026-11-18).

### End-to-End Testing

Playwright tests are in `frontend/e2e/`. Playwright starts its own backend (`:5100`) and Vite (`:5180`) against `conflictfree_e2e`, which `e2e/globalSetup.js` resets before each run (Decision 42). Any server already on `:5000` or `:5173` is left alone.

- `realtime.spec.js` (1 test): two browser contexts (two users). Invitation, acceptance, cancellation, and a new room each reach the other user's open dashboard without a reload.

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