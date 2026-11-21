# ConflictFree Decisions

## Decision 1: Use JavaScript and JSX only

The project uses JavaScript and JSX only. TypeScript is not used.

**Reason:**
- User preference and consistency.
- Simpler development flow without transpile step complexities.
- Keeps the project accessible and straightforward to step through.

---

## Decision 2: Use local MongoDB instead of Docker for now

Local MongoDB Community Server is used for local development. Docker is deferred.

**Reason:**
- MongoDB Community Server was already running locally.
- Development of Auth, Events, and Scheduling can proceed rapidly without container orchestration overhead.
- Docker will be considered later when Redis/BullMQ are added.

---

## Decision 3: Use HTTP-only cookie for JWT auth

JWT tokens are stored in HTTP-only cookies rather than frontend localStorage.

**Reason:**
- HTTP-only cookies protect session tokens from client-side script access (mitigating XSS token theft).
- Better standard foundation for secure web applications.
- Frontend keeps only basic non-sensitive profile info in memory/localStorage for UI rendering.

---

## Decision 4: Support both Google OAuth and manual auth

Authentication supports both Google OAuth and manual email/password registration.

**Reason:**
- Allows users without Google accounts or offline development to use the application.
- Supports future calendar integrations through Google while remaining fully functional as a standalone tool.

---

## Decision 5: Use bcryptjs for password hashing

Manual passwords are hashed with `bcryptjs`.

**Reason:**
- Passwords must never be stored in plain text.
- `bcryptjs` provides pure JavaScript compatibility across all platforms without native compilation dependencies on Windows.

---

## Decision 6: Use JWT for application sessions

The backend issues signed JWTs upon successful authentication.

**Reason:**
- Stateless session model with fast verification in Express middleware.
- Seamless integration with HTTP-only cookies and bearer token authorization for automated tests.

---

## Decision 7: Dual auth support in requireAuth (Cookie & Bearer)

`requireAuth` checks for the auth cookie first, and falls back to the HTTP `Authorization: Bearer <token>` header.

**Reason:**
- Cookies are used by browser clients automatically.
- Bearer tokens allow automated test suites (supertest) and API testing tools to easily test protected routes without setting up cookie jars.

---

## Decision 8: Google OAuth callback redirects to frontend

The Google OAuth backend callback sets the session cookie and redirects to `/auth/callback` on the frontend.

**Reason:**
- Keeps client navigation inside the React Single Page Application.
- Allows the frontend AuthContext to fetch the current user profile seamlessly.

---

## Decision 9: LocalStorage used only for UI display cache

The frontend caches user display data in localStorage solely for fast UI rendering on page load.

**Reason:**
- Prevents initial layout flicker on page refresh.
- True session validity is always verified asynchronously by querying `GET /api/auth/me`. If the session is invalid, the cached data is wiped.

---

## Decision 10: Sparse unique index for googleId

The User model defines `googleId` as optional without a `default: null` and uses a sparse unique index.

**Reason:**
- Manual register users do not have a Google ID.
- MongoDB treats explicit `null` values as duplicate keys in unique indexes unless the field is absent and indexed sparsely.

---

## Decision 11: Implement basic interval overlap conflict detection before advanced algorithms

Scheduling Phase A uses open-interval date overlap checking (`existing.startAt < proposed.endAt && existing.endAt > proposed.startAt`) and database query filtering. Advanced data structures and optimization algorithms are deferred to later phases.

**Reason:**
- Establishes a verified, working baseline for conflict detection and UX feedback first.
- Back-to-back meetings (where an event ends exactly when another begins) are correctly allowed.
- Keeps feature slices verifiable with end-to-end testing before introducing algorithmic complexity.

---

## Decision 12: Available slot search using stepping intervals and busy ranges

Scheduling Phase B searches for available conflict-free time slots using window-based stepping intervals against normalized busy ranges. `slotStepMinutes` defaults to 30 minutes when omitted, and duration is strictly bound within the `windowStart`–`windowEnd` range.

**Reason:**
- Predictable and fast computation for standard business meeting slots without unbounded loops.
- Provides immediate slot discovery on the dashboard so users can click any available slot and populate the event form directly.
- Clear separation between slot generation and future heuristic ranking / multi-resource constraints.

---

## Decision 13: Heuristic slot scoring with custom Min-Heap for best-first ranking

Scheduling Phase C evaluates available slots using a multi-factor heuristic scoring function (`slotScoringService.js`) and sorts them best-first using a custom zero-dependency `MinHeap` implementation (`minHeapService.js`).

**Scoring Weights & Rules:**
- Base score: `50`
- Preferred hours window match (`preferredStartHour`–`preferredEndHour`): `+30` (Reason: `"Inside preferred time window"`)
- Avoid early morning (`< 10:00 UTC`): `-15` penalty or `+5` bonus (Reasons: `"Early morning penalty"` / `"Avoids early morning"`)
- Avoid late day (`> 17:00 UTC`): `-10` penalty or `+5` bonus (Reasons: `"Late day penalty"` / `"Avoids late day"`)
- Earliest slot bonus: `+10, +8, +6...` (Reason: `"Earliest slot bonus"`)
- Clamping: Scores strictly bounded between `0` and `100`.

**Min-Heap Ranking Strategy:**
- Min-Heap comparator configured for max-score extraction: `(a, b) => b.score - a.score || a.startAt - b.startAt`.
- Ties between equal scores are broken deterministically by earlier `startAt` timestamp.

**Reason:**
- Delivers intelligent, explainable slot recommendations that reflect user preferences.
- Min-Heap provides $O(N \log N)$ sorting and establishes the foundation for top-$K$ priority queue extraction in future multi-calendar suggestions.
- Clear, descriptive reason strings give users transparency into why specific time slots are recommended over others.

---

## Decision 14: Discrete time bucket Segment Tree for accelerated interval availability queries

Scheduling Phase D implements a zero-dependency discrete time bucket `SegmentTree` (`segmentTreeService.js`) to accelerate interval availability checks during candidate slot exploration. The continuous search window (`windowStart` to `windowEnd`) is discretized into uniform time buckets of resolution `stepMinutes`, represented by an array-based binary tree.

**Tree Characteristics & Semantics:**
- Bucket indexing: `N = Math.ceil((windowEnd - windowStart) / stepMs)` discrete intervals.
- Busy range registration (`addBusyRange`): Marks overlapping leaf buckets as busy and propagates status up to ancestors in $O(\log N + K)$ operations.
- Range query (`isRangeFree`): Fast sub-window vacancy test in $O(\log N)$ time with strict boundary validation. Returns `true` if all buckets within the query span are completely free.
- Seamless integration: `availableSlotService.js` constructs the `SegmentTree` per search window and delegates slot availability checks directly to the tree.

**Reason:**
- Replaces naive linear iterations across overlapping event lists with an $O(\log N)$ segment tree query.
- Enables scalable expansion to dense calendars and multi-participant scheduling without quadratic comparison penalties.
- Robust boundary semantics ensure back-to-back adjacent meetings are allowed cleanly without false conflict flags.

---

## Decision 15: Deterministic multi-level backtracking constraint relaxation

Scheduling Phase E implements deterministic constraint relaxation (`backtrackingSchedulingService.js`) to provide intelligent smart suggestions when strict user preferences or high minimum scores yield zero available slots.

**Relaxation Hierarchy:**
- **Level 0 (Strict):** Original preferences unchanged. Requires meeting all soft constraints and minimum score.
- **Level 1:** Relaxes preferred time window (`preferredStartHour = null, preferredEndHour = null`).
- **Level 2:** Level 1 + relaxes late day avoidance (`avoidLateDay = false`).
- **Level 3:** Level 2 + relaxes early morning avoidance (`avoidEarlyMorning = false`).
- **Level 4:** All soft constraints removed.
- **Fallback:** If no level produces qualifying slots above the relaxed threshold, top conflict-free slots from Level 4 are returned with explanation metadata.

**Reason:**
- Solves the over-constrained scheduling problem: users receive actionable recommendations even when ideal slots are blocked.
- Completely explainable: each suggestion includes `relaxedConstraints` chips and the UI displays a clear relaxation notice detailing exactly which constraints were relaxed.
- Early exit: exploration halts at the earliest relaxation level that produces viable slots, preserving as many user preferences as possible.

---

## Decision 16: Unified absolute UTC instants with authoritative user IANA timezone evaluation

**Strategy:**
- Absolute instants (UTC ISO strings and MongoDB BSON `Date`) are used universally for database storage, API transport, conflict detection, and candidate slot stepping.
- The authenticated `User.timezone` from MongoDB is the single source of truth for user-facing wall-clock interpretation and preference evaluation.
- `date-fns-tz` is used consistently across frontend (`utils/timezone.js`) and backend (`services/timezoneService.js`) for DST-safe conversions between `datetime-local` inputs/displays and UTC instants.
- Slot scoring evaluates start/end wall-clock hours in the user's timezone rather than UTC hours, resolving early morning / late day penalty miscalculations.

---

## Decision 17: In-memory custom Trie with multi-token indexing and BFS ranking for participant autocomplete

Phase G implements an in-memory prefix `Trie` data structure (`trieService.js`) built from scratch in pure JavaScript, rather than relying on database regex searches.

**Data Structure & Design:**
- **Node Structure:** Each `TrieNode` holds a `children` map for character branching and a `users` map storing safe user objects keyed by their user ID.
- **Multi-Token Indexing:** For each registered user, the Trie indexes the full name, individual word tokens of the name (e.g. first and last names), the full email address, and the username component of the email.
- **Traversal Strategy:** Searching a prefix traverses down to the prefix node and performs a Breadth-First Search (BFS) over descendant branches. BFS guarantees that shortest and closest prefix matches are extracted before deep descendants, producing natural autocomplete prioritization.
- **Deduplication:** A `seenUserIds` set ensures that users matching across multiple tokens (e.g. both name and email) are returned at most once.
- **Security & Privacy:** The Trie strictly stores safe participant projections (`id`, `name`, `email`, `timezone`). Sensitive credentials (`passwordHash`, `googleId`, tokens, events) are never indexed or returned.
- **Scope:** The Trie currently indexes registered participant names and emails for autocomplete. Extending the Trie to index shared resources and calendar events remains future work.

**Reason:**
- Satisfies the research paper requirement for custom algorithmic prefix lookup without external library dependencies.
- Sub-millisecond lookup times ($O(P + M)$ where $P$ is prefix length and $M$ is the number of results collected up to the limit).
- Avoids repetitive unindexed database scans or expensive regex queries across collections.

---

## Decision 18: Invalidation-on-write caching strategy for the in-memory Trie

Phase G implements an invalidation-on-write caching mechanism for the participant autocomplete index in `participantSearchService.js`.

**Cache Mechanics:**
- A singleton `cachedTrie` reference is maintained in memory.
- When `searchParticipants` is called, it checks if `cachedTrie` is null. If null, it performs a single batch query against MongoDB selecting only safe fields (`_id name email timezone`), populates the Trie in memory, and caches the reference.
- Subsequent searches execute directly against the cached Trie in memory with zero database queries.
- **Write Invalidation:** Whenever a new user account is created or modified in `authService.js` (via `registerLocalUser` or `findOrCreateUserFromGoogleProfile`), `invalidateParticipantSearchCache()` is invoked, immediately resetting `cachedTrie = null`.
- The next search automatically reconstructs the Trie from the database with the newly registered user included.

**Reason:**
- Eliminates database latency on search queries while avoiding complex polling or periodic timers.
- Guarantees immediate search consistency for newly registered users without requiring backend process restarts.
- Simple, understandable, and robust without needing external caching infrastructure (Redis is deferred).

---

## Decision 19: Manual single-resource selection and capacity validation for Phase H

Phase H introduces shared resources (rooms and equipment) with explicit manual selection during event creation and slot search.

**Design:**
- Events can optionally associate with one `resourceId`.
- An optional `attendeeCount` field is accepted during booking and availability discovery. If provided, the backend validates that `attendeeCount <= resource.capacity`; otherwise returns HTTP 400 Bad Request.
- Both Available Slot discovery (`POST /api/scheduling/available-slots`) and Smart Suggestions (`POST /api/scheduling/suggestions`) accept `resourceId` and `attendeeCount`, verifying both resource availability and capacity.
- Automatic multi-resource allocation and constraint satisfaction are intentionally deferred to Phase I (Graph Coloring).

**Reason:**
- Delivers a concrete, end-to-end verified slice of resource booking and conflict management without coupling it to complex graph coloring heuristics prematurely.
- Provides immediate utility for users booking conference rooms and equipment.

---

## Decision 20: Soft-deactivation lifecycle policy for shared resources

When a creator deletes a resource via `DELETE /api/resources/:id`, the resource is not physically removed from MongoDB. Instead, `isActive` is set to `false`.

**Design:**
- `DELETE /api/resources/:id` requires authentication and creator ownership (`createdBy.toString() === req.user.id`), returning HTTP 403 Forbidden for non-creators.
- Soft-deactivation sets `isActive: false`.
- The resource listing endpoint `GET /api/resources` returns only active resources (`{ isActive: true }`).
- Booking an inactive resource is rejected with HTTP 400 Bad Request (`"Cannot book an inactive resource"`).
- Existing calendar events referencing the resource retain their historical metadata and references intact.

**Reason:**
- Hard-deleting shared resources would break referential integrity in existing calendar events or require complex cascading updates.
- Preserves audit trails and historical meeting records.

---

## Decision 21: Privacy-preserving HTTP 409 Conflict for resource double-booking

When an event creation or update is attempted for a time window during which the resource is already booked by another event, the backend rejects the request with HTTP 409 Conflict and message `"Resource is already booked for the requested time"`.

**Design:**
- Overlap detection query: `{ resource: resourceId, startAt: { $lt: proposedEndAt }, endAt: { $gt: proposedStartAt }, _id: { $ne: excludeEventId } }`.
- If an overlap exists, HTTP 409 is thrown immediately without revealing the conflicting event's title, description, location, organizer, or attendee list.

**Reason:**
- Enforces strict zero-leakage privacy across users: users know only that the shared resource is occupied at the requested time, without discovering private details about other organizers' meetings.

---

## Decision 22: Open-interval evaluation allowing back-to-back resource bookings

Resource conflict detection and availability search use open intervals `(startAt, endAt)` via `$lt` and `$gt`.

**Design:**
- An event ending at 16:00 and another starting at 16:00 do not overlap (`16:00 < 16:00` is false).
- The discrete-time `SegmentTree` accurately marks minute buckets, allowing back-to-back meetings to be suggested and booked.
- Database indexes on `{ resource: 1, startAt: 1 }` and `{ resource: 1, endAt: 1 }` ensure $O(1)$ overlap checking.

**Reason:**
- Matches real-world meeting room scheduling where back-to-back meetings (e.g. 10:00–11:00 and 11:00–12:00) are standard practice.

---

## Decision 23: Fixed-color greedy Graph Coloring algorithm for automatic shared resource allocation

Scheduling Phase I introduces automatic shared resource recommendation for candidate slots during Available Slot search and Smart Suggestions using an interval Graph Coloring formulation (`resourceGraphColoringService.js`).

**Design:**
- **Graph Formulation:**
  - Vertices ($V$): The proposed candidate meeting slot is an uncolored vertex $V_{cand}$. Each existing event that overlaps the candidate slot and already has an assigned resource represents a fixed-color vertex $V_i$.
  - Edges ($E$): An edge exists between any two vertices whose time intervals overlap in open sets: $start_1 < end_2 \land end_1 > start_2$. Back-to-back meetings ($end_1 = start_2$) have no edge.
  - Colors ($C$): Each resource ID is a distinct color.
  - Fixed Colors: Existing confirmed bookings are never recolored ($color = bookedResourceId$).
  - Palette ($P$): Active resources matching capacity ($\ge attendeeCount$) and optional requested `resourceType`.
- **Greedy Coloring:**
  - Palette is deterministically sorted (alphabetically by resource `name` ascending, tie-broken by `_id` ascending).
  - $V_{cand}$ receives the first available color in $P$ that is not used by any adjacent neighbor:
    $$\text{assignedColor} = \min_{c \in P} \{ c \mid c \notin \{ c(u) : (V_{cand}, u) \in E \} \}$$

**Reason:**
- Satisfies the research proposal's requirement for a real custom Graph Coloring algorithm without faking it via naive loops.
- Respects already confirmed commitments: once a meeting is booked with a room, its allocation is immutable.
- Back-to-back events in the same room are cleanly supported because their intervals do not overlap.

---

## Decision 24: Discard candidate slots when no compatible resource color exists

When `autoAllocateResource: true` is requested and graph coloring cannot find any valid resource color for a candidate slot (either because all eligible resources are occupied by overlapping events or no active resource satisfies the requested capacity/type), the candidate slot is discarded from returned available slots and suggestions.

**Design:**
- `allocateResourceForCandidateSlot` returns `null` if no valid color is assignable.
- `availableSlotService.js` filters out candidate slots where `allocatedResource` is `null`.
- `backtrackingSchedulingService.js` filters out relaxed suggestions where `allocatedResource` is `null`.

**Reason:**
- Prevents recommending slots to the organizer that cannot actually fulfill the user's requirement (e.g. "Find a room for 10 people").
- Guarantees every returned slot and suggestion is actionable and includes a concrete, recommended resource.

---

## Decision 25: Deterministic palette ordering and strict zero-leakage privacy in graph coloring

Automatic resource allocation implements deterministic resource selection and enforces zero data leakage across organizations/users.

**Design:**
- Deterministic Ordering: The color palette is sorted by `name` ascending, then `_id` ascending. When multiple eligible resources are free, the first alphabetically is consistently selected.
- Zero-Leakage Privacy: The graph service only queries `{ startAt: 1, endAt: 1, resource: 1 }` from existing bookings. Other users' event titles, descriptions, owners, and attendees are never read, exposed, or leaked in error responses or reason strings.
- Explainable Reason: The allocated resource summary includes an explainable reason string: `"<Name> is active, fits <N> attendees, and has no overlapping booking during this time slot"`.

**Reason:**
- Ensures repeatable, testable allocation behavior across runs and environments.
- Protects user privacy while providing high user confidence through clear explanation of recommendations.

---

## Decision 26: Canonical shared meeting document model with embedded participant status

Phase J transitions discovered free slots into confirmed shared meetings by extending the existing `Event` model rather than duplicating calendar events per participant.

**Design:**
- Single canonical `Event` document owned by the organizer (`owner: req.user.id`).
- Embedded `participants` array stores subdocuments with `{ user, email, name, status, respondedAt }`.
- Top-level meeting `status` (`"active"` | `"cancelled"`).
- Compatibility: personal events without participants continue to work unchanged.
- Compound indexes `{ "participants.user": 1, startAt: 1 }`, `{ "participants.email": 1, startAt: 1 }`, `{ "participants.user": 1, "participants.status": 1 }`, and `{ status: 1 }` support efficient inbox querying and conflict detection.

**Reason:**
- Eliminates multi-document synchronization inconsistencies across participant calendars.
- Updates to meeting details (time, venue, cancellation) immediately reflect across all attendees without fan-out data migrations.
- Preserves full backward compatibility with personal event CRUD from earlier phases.

---

## Decision 27: Pre-flight conflict rechecks for concurrency protection on standalone MongoDB

MongoDB multi-document ACID transactions require a replica set. Local development operates on a standalone MongoDB Community Server deployment.

**Design:**
- Detected and documented that transactions cannot run on a standalone deployment without replica set configuration.
- Avoided adding fake transaction wrappers or mock session commits that would fail in real standalone MongoDB environments.
- Implemented immediate pre-flight conflict rechecks across all registered participants and the optional reserved resource immediately prior to saving a new meeting or accepting an invitation.
- Rejection via HTTP 409 Conflict if any participant or resource became busy during the confirmation window.

**Reason:**
- Delivers realistic, best-effort concurrency protection without risking deployment failure.
- Upgraded in Phase K to true multi-document ACID transactions via local replica-set configuration.

---

## Decision 28: Invitation lifecycle and status-aware availability filtering

Participants track invitation status across `"pending"`, `"accepted"`, and `"declined"`.

**Design:**
- Newly confirmed meetings initialize all invited participant subdocuments with `status: "pending"` and `respondedAt: null`.
- Availability queries (`availableSlotService.js` and `conflictDetectionService.js`) query:
  `$or: [ { owner: userId }, { participants: { $elemMatch: { user: userId, status: { $in: ["pending", "accepted"] } } } } ]` with `status: { $ne: "cancelled" }`.
- Declined invitations do NOT match the availability query, allowing participants who decline an invitation to remain completely free for other meetings during that slot.
- Cancelled meetings are preserved in MongoDB with `status: "cancelled"`, releasing participant calendars and reserved resources while maintaining an audit trail.

**Reason:**
- Accurately reflects real-world scheduling semantics: pending invites reserve time until decided, accepted invites confirm attendance, and declined invites release the user's calendar.
- Preserves auditability by keeping cancelled meetings in the database without penalizing slot discovery.

---

## Decision 29: Single-node replica set (rs0) for local MongoDB Community Server

Local MongoDB Community Server was converted from standalone mode to a single-node replica set named `rs0`.

**Design:**
- Configured `replication.replSetName: rs0` in `mongod.cfg` without modifying or recreating `dbPath` (`C:\Program Files\MongoDB\Server\8.2\data`).
- Initiated the replica set once via `rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })`.
- Updated Mongoose connection string in `backend/.env` and `backend/.env.example` to `mongodb://127.0.0.1:27017/conflictfree?replicaSet=rs0`.
- Dynamic capability probe (`isTransactionSupported`) detects `setName` in `db.hello()` to safely differentiate replica-set environments from legacy standalone deployments.

**Reason:**
- MongoDB multi-document ACID transactions require a replica set topology.
- A single-node local replica set enables full transactional semantics (`startSession`, `withTransaction`, snapshot isolation, write concerns) without Docker or multi-machine orchestration overhead.
- Preserves all existing development data and local server port (`27017`).

---

## Decision 30: Write-conflict lock strategy via calendarVersion and bookingVersion

MongoDB transactions alone do not prevent phantom interval overlaps when two transactions read disjoint events and insert new events for the same participant or resource.

**Design:**
- Added `calendarVersion` (Number, default: 0) to `User` schema.
- Added `bookingVersion` (Number, default: 0) to `Resource` schema.
- In `transactionSchedulingService.js`:
  - `lockUsersInOrder`: Sorts participant/organizer ObjectIds canonically by hex string and executes `$inc: { calendarVersion: 1 }` inside the transaction session.
  - `lockResourcesInOrder`: Sorts resource ObjectIds canonically and executes `$inc: { bookingVersion: 1 }` inside the transaction session.
- Sorting IDs canonically before locking prevents deadlocks between concurrent cross-meeting confirmations.
- If two concurrent requests attempt to confirm meetings for the same participant or resource, MongoDB's write-conflict detection aborts one transaction. The retry then detects the newly inserted overlapping event and fails cleanly with HTTP 409 Conflict.
- Non-resource personal events bypass transaction locking, avoiding unnecessary overhead for single-user event CRUD.

**Reason:**
- Guarantees strict linearizability and race-condition immunity for interval-based calendar scheduling.
- Completely eliminates double-booking of participants or shared rooms under heavy concurrent load.

---

## Decision 31: Backend tests use a dedicated `*_test` database (2026-11-18 audit)

Integration tests call `Event.deleteMany({})` and `Resource.deleteMany({})`. Before this decision they ran against the development database from `backend/.env`, so every `npm test` erased all development events and resources.

**Design:** `npm test` preloads `backend/tests/helpers/testEnv.js` (`node --test --import`). It sets `MONGODB_URI` to `MONGODB_URI_TEST` if provided, otherwise to the development URI with `_test` appended to the database name (e.g. `conflictfree_test`). It refuses to run if the resulting database name does not end in `_test`. Because `dotenv` never overrides variables that are already set, test files that `import "dotenv/config"` still get the test database.

---

## Decision 32: Invitations and event visibility match the verified user id only (2026-11-18 audit)

Previously `POST/PATCH /api/events` stored a client-supplied `participants` array, and the event list, invitation inbox, and RSVP endpoint matched participants by free-text email. Any user could therefore place an event in another user's calendar or invitation inbox (or inject `status: "accepted"` to block their availability), bypassing the conflict-checked, transactional `POST /api/meetings/confirm`.

**Design:**
- `POST/PATCH /api/events` reject a non-empty `participants` field with HTTP 400 (an empty array is still accepted for backward compatibility). Personal events always store `participants: []`.
- Event visibility, the invitation inbox, RSVP authorization, and availability all match `participants.user` (set only by meeting confirmation from registered users), never `participants.email`.
- The shared query builders live in `backend/src/services/scheduling/calendarQueryService.js`, so conflict checks, slot search, meeting confirmation, RSVP, and meeting moves cannot drift apart.

---

## Decision 33: Conflict checks include held invitations; moving a meeting re-checks members atomically (2026-11-18 audit)

- `POST /api/scheduling/conflicts` now reports owned events **and** shared meetings where the user's invitation is pending or accepted. Declined invitations and cancelled meetings never conflict. Before this, the dashboard conflict check ignored meetings the user had accepted.
- `PATCH /api/events/:id` on a shared meeting whose time changes now re-checks the organizer and every pending/accepted participant **inside** the scheduling transaction, after locking them. A clash returns a generic HTTP 409 that does not reveal the clashing event.
- Cancelled meetings are read-only (HTTP 400 on edit).
- Lock order is the same everywhere: users first, then resources.

---

## Decision 34: Google sign-in is identity-only, state-bound, and requires a verified email (2026-11-18 audit)

- Sign-in requests only `openid email profile`. Before this, it also requested `calendar.readonly` with offline access and forced consent, while discarding the tokens. Calendar access will be a separate, optional consent in Phase O.
- `GET /api/auth/google` generates a random `state`, stores it in a 10-minute HTTP-only `SameSite=Lax` cookie scoped to `/api/auth/google`, and the callback rejects a missing or mismatched state (`invalid_oauth_state`). A client-supplied `?state=` is ignored. This prevents login CSRF.
- A Google identity may create an account, or link to an existing account by email, only if Google reports `email_verified: true`.
- Upstream OAuth error details are logged server-side. The browser receives only a generic code (`google_login_failed`, `google_email_not_verified`, `google_access_denied`).

---

## Decision 35: Central JSON error handling and JWT hardening (2026-11-18 audit)

- `app.js` ends with a JSON 404 for unknown `/api/*` routes and a central error handler. Malformed JSON returns 400 `"Request body must be valid JSON"`. Unexpected errors return 500 `"Internal server error"` and are logged through the structured logger (`services/logger.js`, which redacts secret-looking keys). They are never echoed to the client.
- JWTs are signed and verified with an explicit `HS256` algorithm allow-list. `JWT_EXPIRES_IN` is configurable (default `7d`).
- Cookie `secure`, `sameSite`, `domain`, and max-age are configurable (`COOKIE_SECURE`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN`, `AUTH_COOKIE_MAX_AGE_MS`).

---

## Decision 36: Socket.io authentication reuses the HTTP-only cookie; rooms are server-assigned (Phase L)

- The handshake authenticates with the existing `conflictfree_token` HTTP-only cookie. Tokens in the URL query or the Socket.io `auth` payload are ignored, so they never appear in URLs, logs, or proxies.
- `allowRequest` rejects browser handshakes whose `Origin` is not allow-listed (`FRONTEND_URL`, `CORS_ORIGINS`, plus the localhost/127.0.0.1 twin outside production). This blocks cross-site WebSocket hijacking, which cookie authentication would otherwise allow.
- On connect the server joins the socket to `user:<id>` and `authenticated`. Clients cannot join rooms: every client-originated event is ignored.
- The server emits `session:expired` and disconnects the socket when its JWT expires.

---

## Decision 37: Real-time events are emitted after commit, scoped to the users who can already read the data (Phase L)

- Controllers call `services/schedulingEvents.js` only after the write (and its transaction) has committed. A rejected or rolled-back booking emits nothing.
- Recipients are derived from the canonical record, never from client input. Personal events go to the owner. Shared meetings go to the organizer plus registered participants, the same set that can read the meeting through `GET /api/events`.
- Resource busy-time changes are broadcast as `{ resourceId }` only, with no title, owner, attendees, or time range. Clients re-query availability through the normal authorized API. Resource catalogue changes (`resource:created/updated/deactivated`) carry the same safe resource summary that `GET /api/resources` returns to every authenticated user.

---

## Decision 38: "Instrument" visual design system for the frontend (2026-11-18 redesign)

The frontend uses one small, token-based design system defined as CSS custom properties in `frontend/src/App.css`.

**Design:**
- Warm paper ground (`#F3F2EE`), white panels with hairline borders, near-black ink (`#15161A`) for text and primary buttons.
- Only two signal colours: green (`#0D6650`) means free or confirmed, and orange (`#B4430E`) means conflict. They differ in lightness as well as hue. Every state also has a shape cue (solid, dashed for invitations, outlined or hatched for conflicts), so colour is never the only signal.
- Geist for interface text and Geist Mono with tabular figures for every time, date, and count, loaded from Google Fonts in `index.html` with system font fallbacks.
- 8px control radius, 12px panel radius, 44px minimum touch targets, no card drop shadows, no gradient backgrounds, no emoji (inline SVG icons in `Icon.jsx`).
- The approved mock-up is the "ConflictFree Redesign" design canvas artifact.

**Reason:**
- Scheduling is dense, numeric information. Monospaced time data and a restrained palette keep conflicts and free time readable at a glance.
- One token set keeps the many dashboard surfaces visually consistent without adding a CSS framework or dependency.

---

## Decision 39: Dashboard split into routed pages sharing one DashboardProvider (2026-11-18 redesign)

The single `DashboardPage.jsx` (about 1,800 lines, every feature stacked on one page) was replaced by nested routes under `/dashboard/*`: Overview, Events, New event (composer), Find a time, and Rooms & equipment, inside an `AppShell` sidebar layout.

**Design:**
- All state and handlers moved unchanged into `context/DashboardProvider.jsx`, mounted once around the nested routes, and read through `useDashboard()`. Cross-page flows keep working without a state library. For example, selecting a slot on Find a time fills the composer form.
- Handlers that save (`handleSubmitEvent`, `handleConfirmSharedMeeting`) return a success flag, and pages decide where to navigate.
- The week calendar (Overview) and the full event list (Events) are on different pages, so each event title appears once per page.
- Tests render the real route tree through `src/test/renderDashboard.jsx`, starting at the relevant page.

**Reason:**
- Each task (review the week, fix a conflict, create, search for a time, manage rooms) gets a focused page instead of one long scroll.
- Keeping the original handler logic intact limited the risk of the restructure to layout and navigation. All existing behaviour tests still pass, with only route starting points and selectors updated.

---

## Decision 40: Personal events never carry participants in the UI; inviting people always confirms a shared meeting

**Design:**
- The free-text "Participant email / Participant name" fields were removed from the event form, and `participants` is no longer sent to `/api/events`. This closes the open item from the 2026-11-18 audit (Decision 32): the backend rejects a non-empty array there.
- People are added only through the registered-user participant picker. As soon as one person is picked, the composer's only primary action becomes "Confirm shared meeting" (`POST /api/meetings/confirm`), and "Create event" is hidden.
- When editing an existing event, the picker is hidden, because participant changes on existing meetings are not supported by the API.

**Reason:**
- The previous form let users fill a participant and press "Create event", which the backend then rejected with HTTP 400. Making the shared-meeting path the only path once people are involved removes that dead end, and keeps atomic participant and resource checks on every invitation.

---

## Decision 41: Real-time pushes are applied idempotently; slot results are flagged, not re-run (Phase L)

- The browser can receive a change twice: once in its own HTTP response, and once as a push to the same user's sockets. The order is not guaranteed. Every local write path (create event, confirm meeting, create resource) and every push handler upserts by `id`, so each record is shown once whatever the order.
- A pushed calendar or booking change only marks existing Find-a-time results as possibly out of date. The user chooses **Search again**. Re-running searches automatically would change results under the user's cursor and multiply costly scheduling requests across every open dashboard.
- After a reconnect the dashboard refetches events, invitations, and resources through the normal API instead of replaying missed pushes. The server keeps no per-client event log.

---

## Decision 42: E2E runs on dedicated ports against a reset `conflictfree_e2e` database (Phase L)

- Playwright starts its own backend (`:5100`) and Vite (`:5180`) with `reuseExistingServer: false`. Vite's proxy target comes from `API_PROXY_TARGET`. An E2E run can therefore never attach to a developer's running server or its database.
- `e2e/globalSetup.js` drops `conflictfree_e2e` before each run, so tests start from a known state. It refuses to drop any database whose name does not end in `_e2e`.
- Defaults can be overridden with `E2E_API_PORT`, `E2E_WEB_PORT`, and `E2E_MONGODB_URI`.
