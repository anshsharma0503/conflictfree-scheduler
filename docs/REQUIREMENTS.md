# ConflictFree Requirements

## Product Summary

ConflictFree is a smart scheduling and resource allocation web application. It helps users create meetings, avoid calendar conflicts, coordinate participants, manage shared resources, and receive intelligent scheduling suggestions.

## Technology Requirements

### Frontend

- React
- JavaScript and JSX
- Vite
- React Router
- Vitest
- React Testing Library
- Playwright for end-to-end tests

### Backend

- Node.js
- Express
- JavaScript
- MongoDB
- Mongoose
- JWT authentication
- HTTP-only cookies
- Google OAuth
- bcrypt password hashing
- Socket.io
- BullMQ (pinned `6.7.2`) with ioredis (`5.11.1`) on Redis
- Google Gemini API (REST via `fetch`, no SDK) for the scheduling assistant
- Supertest
- Node test runner

### Local Development

- Local MongoDB Community Server
- Docker only for local Redis (`docker compose up -d redis`, Decision 43). Everything else runs natively.
- Production Redis: Redis Cloud or Upstash through `REDIS_URL` (`rediss://`), with `maxmemory-policy noeviction`.
- Backend default port: `5000`
- Frontend default port: `5173`

## User Interface Requirements

### Implemented (2026-11-18 redesign)

- One visual design system ("Instrument", Decision 38): paper/ink palette, green for free or confirmed, orange for conflict, Geist and Geist Mono type (self-hosted, so pages never wait on a third-party font server; Decision 50), and no colour-only signals.
- The authenticated app uses a sidebar layout with separate pages for Overview, Events, New event, Find a time, and Rooms & equipment (Decision 39). A global status line shows the latest action result.
- Selecting a slot or suggestion on Find a time opens the composer with the time and any allocated resource filled in.
- Picking participants turns the composer's action into "Confirm shared meeting". Personal events cannot carry participants (Decision 40).
- Layouts work down to phone width (390px): the sidebar becomes a top bar, side columns stack, and the week calendar scrolls inside its own box.
- Interactive elements are real buttons, links, and labelled inputs, with 44px minimum touch targets and visible focus rings.
- Dashboard pages update live through the Phase L socket client (see Real-Time Requirements).
- A notification bell in the top bar shows the unread count and the latest notifications (Phase M).

### Planned

- Dark theme.
- Opening an event directly from the week calendar.

## Authentication Requirements

### Implemented

- Users can register manually with name, email, and password.
- Users can log in manually with email and password.
- Passwords are hashed with bcrypt before storage.
- Users can authenticate with Google OAuth.
- Google OAuth stores/fetches users in MongoDB.
- Backend stores JWT in an HTTP-only cookie.
- Frontend does not store JWT in localStorage.
- Frontend stores user data locally only for UI convenience.
- Backend exposes `/api/auth/me`.
- Backend exposes `/api/auth/logout`.
- Logout clears the auth cookie.
- Protected backend routes use authentication middleware.
- Protected frontend routes redirect logged-out users to `/login`.
- Each account stores its real IANA timezone. Sign-up records the browser's zone (falling back to UTC if invalid). Users can switch to their browser's zone from the sidebar (`PATCH /api/auth/me`, Decision 51).

### Planned Later

- Choosing any timezone (not only the browser's), and offering the switch at phone width.

- CSRF protection.
- Rate limiting.
- Forgot password flow.
- Email verification.
- Production-grade secure cookie deployment.
- Refresh-token rotation if needed.

## Calendar/Event Requirements

### Implemented

Users can:

- Create calendar events.
- View their own event list.
- View a single event through the backend API.
- Update their own events.
- Delete their own events.
- Invite registered participants by picking them in the event composer, which confirms a shared meeting. Personal events carry no participants.
- Store participant email, name, and status on shared meetings.
- Store event title, description, start time, end time, timezone, and location.
- Store event source as `manual` or `google`.
- Store optional Google event id for future Google Calendar sync.
- Access only their own events.
- Use protected event APIs through authenticated sessions.

Implemented backend API routes:

```text
POST   /api/events
GET    /api/events
GET    /api/events/:id
PATCH  /api/events/:id
DELETE /api/events/:id
```

Implemented frontend behavior:

- Overview (`/dashboard`) shows the week's events in a Monday–Sunday calendar in the user's timezone, with overlaps drawn side by side in conflict colours.
- Events (`/dashboard/events`) lists events with edit, delete, cancel meeting, and RSVP actions.
- The composer (`/dashboard/events/new`) creates and edits events and cancels edit mode.
- Event UI is protected behind authentication.

Implemented validation:

- Event owner is required.
- Event title is required.
- Event start time is required.
- Event end time is required.
- Event end time must be after start time.
- Participant email must be valid.
- Participant status must be one of: `pending`, `accepted`, `declined`.

### Planned Later

- Month and day calendar views, and opening an event from the week calendar (week view is implemented).
- Event detail page or modal.
- Recurring events.
- Google Calendar import/sync.

## Scheduling Requirements

### Implemented (Phase A: Overlap Conflict Detection)

- Backend conflict detection service (`conflictDetectionService.js`) validates proposed time ranges and checks for conflicts against existing events.
- Time range overlap formula: `existing.startAt < proposed.endAt && existing.endAt > proposed.startAt` (open-interval, allowing back-to-back meetings).
- Self-conflict exclusion: supports `excludeEventId` when updating an existing event so an event does not conflict with itself.
- Protected API endpoint: `POST /api/scheduling/conflicts` scoped to the authenticated user.
- Frontend scheduling service (`schedulingService.js`) to query conflicts.
- Frontend conflict warning panel on Dashboard: triggers before event creation/update, displays conflicting event titles, times, and locations, and blocks saving until non-conflicting times are selected.

### Implemented (Phase B: Available Slot Finder)

- Backend available slot service (`availableSlotService.js`) finds conflict-free time slots for a given search window and meeting duration.
- Generates candidate slots stepping through the search window (default 30 min step, customizable).
- Excludes slots overlapping user's existing events; permits boundary-adjacent slots (back-to-back meetings).
- Returns empty array if meeting duration exceeds search window.
- Protected API endpoint: `POST /api/scheduling/available-slots` scoped to the authenticated user.
- Frontend available slot finder UI in the dashboard pages (`frontend/src/pages/dashboard/`):
  - Input fields for window start, window end, duration (minutes), and step (minutes).
  - Search submission with loading and validation error states.
  - Interactive list of available slots with formatted time ranges.
  - Clicking an available slot automatically populates the event form's start and end times.
  - Clear empty state message when no slots fit.

### Implemented (Phase C: Slot Scoring & Min-Heap Ranking)

- Custom `MinHeap` implementation (`minHeapService.js`) built from scratch with custom comparator support (`push`, `pop`, `peek`, `size`).
- Slot scoring service (`slotScoringService.js`):
  - Normalizes optional user preferences (`preferredStartHour`, `preferredEndHour`, `avoidEarlyMorning`, `avoidLateDay`, `earliestSlotBonus`).
  - Evaluates heuristic scores starting from base score 50:
    - Preferred time window match: `+30` bonus with reason `"Inside preferred time window"`.
    - Avoid early morning (< 10:00 UTC): `-15` penalty (`"Early morning penalty"`) or `+5` bonus (`"Avoids early morning"`).
    - Avoid late day (> 17:00 UTC): `-10` penalty (`"Late day penalty"`) or `+5` bonus (`"Avoids late day"`).
    - Earliest slot bonus: `+10, +8, +6...` (`"Earliest slot bonus"`).
    - Scores clamped between `0` and `100`.
  - Ranks candidate slots using `MinHeap` best-first (`b.score - a.score`, earlier `startAt` tie-breaker).
- Protected API endpoint `POST /api/scheduling/available-slots` accepts `preferences` in request body and returns slots sorted best-first with `score` and `reasons`.
- Frontend dashboard UI (`frontend/src/pages/dashboard/`):
  - Added "Preferences & Ranking (Optional)" fieldset in Available Slot Finder.
  - Inputs for preferred start/end hour and checkboxes for early morning, late day, and earliest slot bonus.
  - Slot cards display styled score badges (`Score: 85`) and readable reason tags.
  - Selecting any ranked slot populates start/end times in the Event form.

### Implemented (Phase D: Discrete Time Bucket Segment Tree)

- Discrete time bucket `SegmentTree` (`segmentTreeService.js`) built from scratch with an array-based binary tree of size `4 * N` over `N` discrete buckets of resolution `stepMinutes`.
- `addBusyRange`: Clamps event bounds to window boundaries, translates them to discrete bucket index ranges, and marks tree nodes in $O(\log N + K)$ operations.
- `isRangeFree`: Evaluates interval vacancy in $O(\log N)$ time with strict window checks, cleanly allowing back-to-back adjacent meetings without conflict flags.
- `getCoveredIndexes`: Inspects the tree and extracts all currently occupied discrete bucket indexes.
- Integrated directly into `availableSlotService.js` (`findAvailableSlots` and `isSlotAvailable`), accelerating availability tests across candidate intervals.

### Implemented (Phase E: Backtracking Constraint Relaxation & Smart Suggestions)

- Backtracking constraint relaxation engine (`backtrackingSchedulingService.js`):
  - `normalizeSuggestionInput`: Validates search windows, duration, step, `minimumScore` (0–100), and `maxSuggestions`.
  - `buildRelaxationPlans`: 5-level deterministic relaxation hierarchy (Level 0 Strict to Level 4 All Relaxed).
  - `applyRelaxationPlan`: Selectively removes constraints based on the plan level.
  - `findSuggestionsWithRelaxation`: Explores relaxation levels sequentially, evaluating available slots, adjusting score thresholds for relaxed constraints, and early-exiting on the first qualifying level.
  - Fallback: Over-constrained inputs return conflict-free slots from Level 4 with `relaxed: true` and explanation metadata.
- Protected API endpoint: `POST /api/scheduling/suggestions` scoped to authenticated user with authoritative timezone normalization.
- Frontend scheduling service (`schedulingService.js`): added `findSmartSuggestions`.
- Frontend dashboard UI (`frontend/src/pages/dashboard/`):
  - Input fields for "Minimum score" and "Max suggestions" in the slot search panel.
  - "Find smart suggestions" action button.
  - Smart suggestions region with styled suggestion cards (`.suggestion-card`) displaying score badges, reason tags, and relaxed constraint chips.
  - Relaxation notice banner (`role="note"`, `aria-label="Relaxation notice"`) detailing exactly which constraints were relaxed.
  - Clicking any smart suggestion card auto-populates start and end fields in the Event form.

### Implemented (Phase F: Multi-Participant Availability Discovery)

- Participant availability service (`participantAvailabilityService.js`):
  - Normalizes and validates participant email addresses (case-insensitive trimming and deduplication).
  - Automatically includes the authenticated organizer as `participants[0]`.
  - Safely ignores organizer email if entered manually in the participant list.
  - Resolves participants against registered MongoDB User accounts using case-insensitive lookup (collation).
  - Rejects unknown participant email addresses with descriptive HTTP 400 validation errors.
  - Returns safe, opaque participant summaries (`{ id, name, email, timezone }`).
- Access policy:
  - *“Any authenticated registered user may request opaque free/busy availability for explicitly entered registered-user emails. The API returns only safe participant summaries and mutually available slots, never event details.”*
  - Granular calendar sharing permissions, organization/team tenant isolation, and participant consent workflows are marked as future security enhancements.
- Strict data privacy & projection:
  - Event queries strictly project `startAt endAt` fields: `Event.find(query).select("startAt endAt")`.
  - Never loads or returns private event properties (title, description, location, googleEventId, attendees) across users.
- Multi-owner overlap detection via discrete-bucket Segment Tree:
  - Single efficient MongoDB query collects busy events across all selected participant IDs: `{ owner: { $in: userIds }, startAt: { $lt: windowEnd }, endAt: { $gt: windowStart } }`.
  - Busy intervals across all participants are registered in the discrete-bucket `SegmentTree`.
  - Open-interval evaluations guarantee conflict-free slots where back-to-back meetings are permitted.
  - Absolute UTC instants govern interval overlap regardless of participant timezones.
  - Organizer's fresh MongoDB User record timezone is authoritative for heuristic preference scoring and search window normalization.
- Protected API endpoints extended:
  - `POST /api/scheduling/available-slots` accepts optional `participantEmails: ["email1@example.com", "email2@example.com"]`.
  - `POST /api/scheduling/suggestions` accepts optional `participantEmails: ["email1@example.com", "email2@example.com"]` and coordinates multi-user availability with constraint relaxation.
  - Compatible response format: `{ success: true, participants: [{ id, name, email, timezone }], slots: [...] }`.
- Frontend dashboard UI (`frontend/src/pages/dashboard/`):
  - Dedicated input field for `Participant user emails (comma-separated registered users)`.
  - Both available slots and smart suggestions share this input.
  - Displays styled Coordinated Participants summary region with name, email, and timezone chips.
  - Renders validation errors (e.g. unknown participant email) in form error banner.
  - Clicking any multi-user slot or suggestion auto-populates the Event form.
  - Clearly notes availability discovery scope: saving an event populates the organizer's personal calendar; shared invites and calendar sync are part of the confirmation phase.

### Implemented (Phase G: Trie-Based Participant Search & Autocomplete)

- Custom in-memory `Trie` implementation (`trieService.js`) built from scratch in JavaScript:
  - Multi-token prefix indexing: indexes full user names, individual name words, full email addresses, and email username prefixes.
  - Subtree search via Breadth-First Search (BFS) returning closest matching participants first.
  - Case-insensitive key matching.
  - Automatic deduplication by user ID when a participant matches both by name and email.
  - Configurable result limits (default 10, maximum 20).
  - Strict privacy guarantees: returns safe participant summaries only (`{ id, name, email, timezone }`) without leaking passwords, password hashes, Google IDs, auth tokens, or private events.
  - Note: The Trie currently indexes registered participant names and emails for autocomplete. Extending the Trie to index shared resources and calendar events remains future work.
- Participant search service (`participantSearchService.js`):
  - Validates search query: minimum 2 non-whitespace characters required; returns descriptive HTTP 400 otherwise.
  - Validates result limits: positive integer between 1 and 20 required; returns HTTP 400 otherwise.
  - Automatically excludes the authenticated organizer from search results.
  - Invalidation-on-write caching: Trie is built lazily on first query and automatically invalidated whenever a user registers or logs in via Google, ensuring newly registered users are immediately searchable without server restarts.
- Protected API endpoint:
  - `GET /api/participants/search?q=<prefix>&limit=10` protected with `requireAuth`.
  - Returns `{ success: true, participants: [{ id, name, email, timezone }] }`.
- Frontend `ParticipantPicker` component (`ParticipantPicker.jsx`):
  - Debounced search queries (300 ms) triggered after 2 characters typed.
  - Accessible suggestions dropdown with loading, no-results, and error states.
  - Full keyboard accessibility: ArrowDown/ArrowUp cycle suggestions, Enter adds highlighted suggestion, Escape dismisses dropdown.
  - Selected participant chips with accessible Remove buttons.
  - Blocks duplicate participant additions and excludes organizer.
  - Seamlessly integrates with both Available Slot search and Smart Suggestions on the Find a time page (`FindTimePage.jsx`), providing `participantEmails` array payload.

### Implemented (Phase H: Shared Resources, Room Booking, and Resource Availability)

- Shared Resource Data Model (`Resource.js`):
  - Stores `name` (unique, case-insensitive collation index), `type` (`"room"` or `"equipment"`), `capacity` (integer $\ge 1$), `location`, `description`, `isActive` (boolean, default true), and `createdBy` (User ref).
  - Schema-level validations for type enum, positive integer capacity, and required fields.
- Event Association & Indexes (`Event.js`):
  - Optional `resource` field referencing `Resource` model (default `null`).
  - Compound indexes `{ resource: 1, startAt: 1 }` and `{ resource: 1, endAt: 1 }` for high-performance open-interval availability querying.
- Resource Management (`resourceService.js` & `resourceController.js`):
  - Authenticated endpoints:
    - `POST /api/resources`: creates a new resource with unique name check.
    - `GET /api/resources`: lists all active resources sorted by name for any authenticated user.
    - `GET /api/resources/:id`: fetches a single resource by ID.
    - `PATCH /api/resources/:id`: allows creator to update resource details and capacity (enforces 403 Forbidden for non-creators).
    - `DELETE /api/resources/:id`: performs soft deactivation (`isActive: false`), never physically deleting historical event references (enforces 403 Forbidden for non-creators).
- Resource Booking & Availability (`resourceAvailabilityService.js`):
  - `validateResourceForBooking`: checks resource exists, is active (HTTP 400), satisfies attendee capacity requirements (HTTP 400), and validates that the resource has no overlapping bookings in open intervals ($O(1)$ query excluding the event being updated).
  - Throws HTTP 409 Conflict with generic message `"Resource is already booked for the requested time"`, protecting other users' event details.
  - Allows back-to-back resource bookings without collision (boundary equality allowed).
  - Integrated into event creation (`POST /api/events`) and event updates (`PATCH /api/events/:id`).
- Slot Finder & Smart Suggestions with Shared Resources:
  - `POST /api/scheduling/available-slots` and `POST /api/scheduling/suggestions` accept optional `resourceId` and `attendeeCount`.
  - Resource busy intervals are fetched using `findResourceBusyRanges` and inserted into the `SegmentTree` alongside participant busy intervals.
  - Returned response includes safe resource metadata (`{ id, name, type, capacity }`).
- Frontend UI (`frontend/src/pages/dashboard/`):
  - Dedicated "Shared Resources" panel to create, list, edit, and deactivate active resources.
  - Event form includes "Book resource" selector and "Expected attendees" input.
  - Slot Finder includes "Required resource (Optional)" selector and "Required attendees" input.
  - Displays selected slot resource badge in results and persists resource selection on click-to-fill into the event form.
  - Event calendar cards display assigned resource badges.
  - Note: Phase H implements manual selection and conflict-safe availability checking for a single shared resource. Automatic multi-resource allocation and Graph Coloring are implemented in Phase I. Database-level atomic reservations with distributed locking remain deferred until high-concurrency needs arise.

### Implemented (Phase I: Graph-Coloring-Based Automatic Resource Allocation)

- Automatic shared resource allocation powered by a custom in-memory Graph Coloring engine (`resourceGraphColoringService.js`):
  - Formulates an interval conflict graph where:
    - Each existing confirmed booking overlapping the candidate time slot with an assigned resource represents a fixed-color vertex ($color = resourceId$).
    - The proposed meeting slot represents an uncolored vertex adjacent to all overlapping bookings ($open\ interval:\ start_1 < end_2 \land end_1 > start_2$; back-to-back non-overlapping bookings have no edge).
    - Eligible active resources matching capacity and optional resource type filter form the candidate color palette.
  - Greedy coloring order: sorts palette deterministically (alphabetically by `name` ascending, tie-broken by `_id` ascending).
  - Confirmed bookings are never recolored.
  - Candidate slot receives the first color in the palette not used by any adjacent vertex.
  - If all colors are blocked by adjacent vertices or no eligible resource exists, allocation returns `null`, and the candidate slot is discarded from results.
- Protected API extensions:
  - `POST /api/scheduling/available-slots` and `POST /api/scheduling/suggestions` accept optional parameters:
    - `autoAllocateResource: true` (boolean)
    - `resourceType: "room" | "equipment"` (optional string)
    - `attendeeCount: 4` (positive integer)
  - Mutual exclusivity validation: providing both `resourceId` (manual mode) and `autoAllocateResource: true` in the same request returns HTTP 400 Bad Request (`"Cannot specify both resourceId and autoAllocateResource"`).
  - Validates `resourceType` against enum `["room", "equipment"]` (HTTP 400) and `attendeeCount` as positive integer (HTTP 400).
  - When `autoAllocateResource` is omitted or false and no `resourceId` is supplied, existing behavior is preserved identically.
- Privacy & Response format:
  - Discarded candidates or busy resources never leak another organizer's event details, attendees, title, or description.
  - Returns safe resource summary attached to each valid slot/suggestion:
    - `allocatedResource: { id, name, type, capacity, location }`
    - `allocationReason: "<Resource Name> is active, fits <N> attendees, and has no overlapping booking during this time slot"`
- Frontend dashboard UI (`frontend/src/pages/dashboard/`):
  - Slot Finder includes "Automatically allocate a resource" checkbox.
  - Checking auto-allocation automatically disables and clears the manual resource selector, preventing mutual-exclusivity conflicts.
  - Displays "Resource type preference" dropdown ("Any type", "Room", "Equipment") when auto-allocation is active.
  - Available slot pills and smart suggestion cards display an "Allocated: <Resource Name> (<type>, cap: <cap>)" badge and descriptive allocation reason.
  - Clicking any auto-allocated slot or suggestion populates the Event form with the allocated resource ID, attendee count, and start/end times.

### Implemented (Phase J: Shared Meeting Confirmation and Invitations)

- Canonical Shared Meeting Data Model (`Event.js`):
  - Single canonical event document owned by the organizer with embedded `participants` array.
  - Extended participant subdocuments with `user` (User ObjectId), `email`, `name`, `status` (`"pending" | "accepted" | "declined"`), and `respondedAt`.
  - Added top-level meeting `status` (`"active" | "cancelled"`).
  - High-performance compound indexes: `{ status: 1 }`, `{ "participants.user": 1, startAt: 1 }`, `{ "participants.email": 1, startAt: 1 }`, and `{ "participants.user": 1, "participants.status": 1 }`.
  - Compatibility guarantee: existing personal events without participants continue to work unchanged.
- Best-Effort Concurrency Protection (Phase J Historical Foundation):
  - In Phase J before replica set configuration, immediate pre-flight conflict rechecks were executed for all participants and the reserved resource right before creating a meeting or accepting an invitation.
  - Returned HTTP 409 Conflict if any participant or resource became unavailable, preventing double bookings without fake transactions.

### Implemented (Phase K: MongoDB Replica Set and True Atomic Participant/Resource Booking)

- Local MongoDB Community Server Replica Set:
  - Migrated local standalone MongoDB Community Server to single-node replica set `rs0` preserving the existing `dbPath` (`C:\Program Files\MongoDB\Server\8.2\data`).
  - Verified topology via `mongosh --eval "db.hello().setName"` returning `rs0`.
  - Backend connection configured with `mongodb://127.0.0.1:27017/conflictfree?replicaSet=rs0`.
- Scheduling Version & Concurrency Models:
  - Added `calendarVersion: { type: Number, default: 0 }` to `User` schema (`User.js`).
  - Added `bookingVersion: { type: Number, default: 0 }` to `Resource` schema (`Resource.js`).
- Write-Conflict Lock Strategy (`transactionSchedulingService.js`):
  - Solves the open-interval phantom overlap vulnerability where concurrent read-only queries insert disjoint events without native database-level row conflicts.
  - Canonical sorted ObjectId locking order: user and resource ObjectIds are deduplicated and sorted canonically by hex string before acquisition to guarantee deadlock-free locking.
  - `lockUsersInOrder`: Atomically increments `calendarVersion` inside the MongoDB session for all participants and the organizer.
  - `lockResourcesInOrder`: Atomically increments `bookingVersion` inside the MongoDB session for the reserved resource.
  - Forces MongoDB to produce a real write-conflict error on concurrent overlapping transactions, triggering automatic transaction abort and retry. If a slot becomes unavailable after concurrent confirmation, returns HTTP 409 Conflict without leaking details.
- Fail-Closed Capability Detection (`isTransactionSupported`):
  - Dynamically probes `db.admin().command({ hello: 1 })` for `setName` or `hosts`.
  - On unsupported standalone MongoDB instances, throws HTTP 503 Service Unavailable (`"Atomic scheduling requires a MongoDB replica set."`) and never silently falls back to dirty non-atomic writes.
- End-to-End Atomic Transaction Coverage:
  - `POST /api/meetings/confirm`: Locks organizer, all participants, and optional resource inside session; validates availability; inserts canonical shared meeting.
  - `PATCH /api/meetings/:id/invitation-response`: Locks responding participant inside session; validates conflict status; commits RSVP.
  - `POST /api/meetings/:id/cancel`: Locks participants and resource; sets status to cancelled inside session.
  - Personal Event CRUD (`/api/events`): Operations reserving or altering resources lock resource and user inside transaction session.
- Frontend Actionable Warning:
  - The composer and Overview catch replica-set errors and displays an actionable warning prompt alerting users if their MongoDB deployment lacks a replica set.
- Meeting API Endpoints (`/api/meetings`):
  - `POST /api/meetings/confirm`: Confirms a shared meeting for the authenticated organizer, resolves registered participants via `resolveParticipants`, enforces organizer exclusion from participants array, validates capacity, initializes invitations to `pending`, and rechecks availability.
  - `GET /api/meetings/invitations`: Returns pending invitations for the authenticated user, populated with safe organizer details and resource metadata.
  - `PATCH /api/meetings/:id/invitation-response`: Allows invited participant to accept or decline. Accepting rechecks for participant conflicts and returns HTTP 409 if a conflict arose. Updates invitation status and timestamp.
  - `POST /api/meetings/:id/cancel`: Organizer-only endpoint to cancel a meeting. Sets meeting `status: "cancelled"` and preserves document for history while freeing attendee and resource availability.
- Availability & Conflict Filtering:
  - All availability services (`availableSlotService.js`, `conflictDetectionService.js`, `resourceAvailabilityService.js`, `resourceGraphColoringService.js`) filter out `status: "cancelled"`.
  - Participant availability queries match both owned events and shared events where the participant has `status: { $in: ["pending", "accepted"] }`.
  - Declined invitations do not block the participant's future slot availability.
- Privacy & Authorization:
  - Strict privacy guarantees: conflict checks never leak titles, descriptions, or private event metadata of other participants.
  - Invitee authorization: invitees can view invitation and event details, but cannot edit or cancel meetings owned by the organizer (returns HTTP 403). Non-attendees receive HTTP 404.
- Frontend UI (`frontend/src/pages/dashboard/`):
  - "Confirm shared meeting" action when participants are selected.
  - "Meeting invitations" inbox section with one-click "Accept" and "Decline" buttons.
  - Event cards display meeting status badge (`Active` or `Cancelled`) and participant invitation response chips (`pending`, `accepted`, `declined`).
  - Organizer controls include "Cancel meeting" for active shared meetings. Invitee controls provide in-place RSVP response options.

Implemented API routes:

```text
POST   /api/events
GET    /api/events
GET    /api/events/:id
PATCH  /api/events/:id
DELETE /api/events/:id
POST   /api/resources
GET    /api/resources
GET    /api/resources/:id
PATCH  /api/resources/:id
DELETE /api/resources/:id
POST   /api/scheduling/conflicts
POST   /api/scheduling/available-slots
POST   /api/scheduling/suggestions
GET    /api/participants/search
POST   /api/meetings/confirm
GET    /api/meetings/invitations
PATCH  /api/meetings/:id/invitation-response
POST   /api/meetings/:id/cancel
```

### Planned Next (Advanced Scheduling & Optimization Algorithms)

Required algorithmic components from the proposal:

- Event and resource indexing extensions to the Trie data structure.

(Socket.io live updates were delivered in Phase L, BullMQ background workers in Phase M, and Gemini scheduling NLP in Phase N.)


## Resource Requirements

### Implemented (Phase H and Phase I)

Users can create, view, edit and deactivate shared rooms and equipment, book them on events and meetings without double-booking, and have a free resource allocated automatically. Details: "Phase H" and "Phase I" under Scheduling Requirements.

### Planned

- Shared spaces as a separate resource type (today: `room` and `equipment`).

## AI/Natural Language Requirements

### Implemented (Phase N, 2026-11-21)

On Find a time, users can describe a meeting in one sentence, e.g. "Schedule a meeting with Alex tomorrow afternoon for one hour" or "45 min with Priya next Tuesday afternoon, need a room for 4". Google Gemini extracts:

- `title`
- `participants` (names or emails as written)
- date/time range (relative dates are read in the user's timezone)
- `duration`
- constraints: preferred hours, "not too early", "not too late", room or equipment, number of attendees

Behaviour:
- The app shows its interpretation first: title, window, length, preferences, room needs, people, and any assumptions it made ("No length given, so using 30 minutes"). Nothing is searched or booked until the user chooses "Search these times" (runs smart suggestions on exactly those values) or "Fill the form only".
- People are matched to registered ConflictFree accounts on the server. Each one is shown as matched, ambiguous ("Which “Alex”?", the user chooses), or "No account for “Zed”". The requester is never added. Unresolved names are left out of the search.
- Selecting a resulting time opens the composer with the parsed title and the chosen people, ready to "Confirm shared meeting".
- Text that isn't a scheduling request, or a time already in the past, gets a clear message instead of a draft.
- Only the sentence, the current local time and the user's timezone go to Gemini, never other users' data or the user's calendar. The request text is not logged.
- When Gemini is busy or slow, the app tries a fallback model and one delayed retry, then says so ("busy right now… or fill in the form yourself"). The rest of Find a time keeps working.
- Each user can make up to 10 assistant requests per minute.
- Without `GEMINI_API_KEY`, the assistant is hidden and the rest of the app works unchanged.

API: `GET /api/assistant/status`, `POST /api/assistant/parse-request` (details in `ARCHITECTURE.md`). Decisions 47–49.

### Planned

- Natural-language requests from the composer and event editing ("move my 3pm to Friday").
- Explaining suggestions in plain language.
- Shared (Redis) rate limiting across API instances (Phase P).

## Real-Time Requirements

### Implemented (Phase L backend, 2026-11-18)

- Socket.io server on the API's HTTP server (`/socket.io`).
- Authentication uses the existing HTTP-only auth cookie only. Tokens are never accepted in URLs.
- Handshakes from Origins that are not allow-listed are rejected.
- Each user has a private, server-assigned room. Clients cannot join rooms.
- Updates are emitted only after a successful commit, and only to users already authorized to read the data:
  - meeting confirmed, invitation created, invitation accepted/declined, meeting updated, meeting cancelled
  - personal event created/updated/deleted
  - resource catalogue changes and resource busy-time changes (resource id only)
- Sockets are disconnected when the session JWT expires.

### Implemented (Phase L frontend, 2026-11-18)

- The dashboard opens one socket per session. Invitations, events and meetings, and the resource catalogue update without a browser refresh.
- Find-a-time results are flagged "may be out of date" when calendars or bookings change, with a Search again action.
- No duplicate listeners. Everything is cleaned up on logout and unmount. Reconnect is automatic and refetches data afterwards. On session expiry the user is signed out.
- The connection state is visible in the top bar.
- Verified with Playwright using two browser contexts (two users).

### Implemented (Phase M, 2026-11-21)

- `notification:created` `{ notification, unreadCount }` is pushed to the recipient's private room when a notification is stored.
- `notification:read` `{ notificationIds | all, unreadCount }` is pushed to the user's own room after a mark-read, so other tabs stay in sync.

## Background Job Requirements

### Implemented (Phase M, 2026-11-21)

Redis + BullMQ power in-app notifications and event reminders (Decisions 43–46).

**Notifications.** A user gets an in-app notification when:
- they are invited to a shared meeting (`invitation.created`);
- someone accepts or declines their meeting (organizer only, `invitation.responded`);
- the organizer moves a meeting, or changes its location or room/equipment, unless they declined it (`meeting.updated`). Edits to the title or description only do not notify;
- the organizer cancels or deletes a meeting they were invited to (`meeting.cancelled`).

The person who made the change is never notified about their own action.

**Reminders.**
- Each user chooses how long before an event to be reminded: Off, 5, 10, 15 (default), 30 or 60 minutes, or 1 day.
- Reminders go to the event's organizer and to participants who accepted. Pending and declined invitees get none.
- A reminder is sent once per event and start time. Moving the event sends a new one. Cancelled and already-started events get none.
- Reminders arrive within one sweep interval of being due (default 60s).

**Behaviour and guarantees.**
- Notifications are stored in MongoDB, newest first, with an unread count, and kept for 90 days.
- A notification is never duplicated, including when its job is retried.
- Users can mark one or all as read. They only ever see their own notifications.
- Without `REDIS_URL` the app runs normally with notifications and reminders off. If Redis goes down, every request still succeeds. The UI shows "paused" while delivery is down. Workers and the reminder schedule recover by themselves when Redis returns, including after Redis lost its data.
- Known limitation: meeting notifications for actions taken while Redis was unreachable are not sent later. Reminders are unaffected.

API: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET|PATCH /api/notifications/preferences` (details in `ARCHITECTURE.md`).

### Planned

- Calendar sync jobs (Phase O, Google Calendar).
- Transactional outbox, so notifications for actions taken during a Redis outage are sent once Redis returns.
- A separate worker process (needs the Socket.io Redis adapter/emitter) for horizontal scaling (Phase P).
- Email delivery of notifications (out of scope until in-app notifications have been in use).