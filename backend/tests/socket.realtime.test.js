import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import Resource from "../src/models/Resource.js";
import User from "../src/models/User.js";
import { closeSocketServer, createSocketServer } from "../src/realtime/socketServer.js";
import { AUTH_COOKIE_NAME } from "../src/services/authCookieService.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const ALLOWED_ORIGIN = "http://localhost:5173";
const emails = ["rt-org@example.com", "rt-alpha@example.com", "rt-beta@example.com", "rt-outsider@example.com"];

let httpServer;
let ioServer;
let baseUrl;
let organizer;
let alpha;
let beta;
let outsider;
const openSockets = new Set();

function tokenFor(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({ id: user._id.toString(), email: user.email, name: user.name });
}

function connect({ cookie, origin = ALLOWED_ORIGIN, query, auth } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;

  const socket = connectClient(baseUrl, {
    path: "/socket.io",
    transports: ["polling", "websocket"],
    extraHeaders: headers,
    query,
    auth,
    reconnection: false,
    forceNew: true,
    timeout: 4000,
  });
  openSockets.add(socket);
  return socket;
}

function connectAs(user, options = {}) {
  const socket = connect({ cookie: `${AUTH_COOKIE_NAME}=${tokenFor(user)}`, ...options });

  return new Promise((resolve, reject) => {
    socket.once("session:ready", () => resolve(socket));
    socket.once("connect_error", (error) => reject(error));
  });
}

function expectConnectError(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => reject(new Error("socket unexpectedly connected")));
    socket.once("connect_error", (error) => resolve(error));
  });
}

function waitForEvent(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${eventName}`)),
      timeoutMs,
    );
    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function recordEvents(socket) {
  const received = [];
  socket.onAny((eventName, payload) => received.push({ eventName, payload }));
  return received;
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

async function createUser(name, email) {
  return User.create({
    name,
    email,
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });
}

function api(user) {
  const authorization = `Bearer ${tokenFor(user)}`;
  return {
    post: (path, body) => request(app).post(path).set("Authorization", authorization).send(body),
    patch: (path, body) => request(app).patch(path).set("Authorization", authorization).send(body),
    del: (path) => request(app).delete(path).set("Authorization", authorization),
  };
}

before(async () => {
  process.env.FRONTEND_URL = ALLOWED_ORIGIN;
  await connectDatabase();

  httpServer = http.createServer(app);
  ioServer = createSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

beforeEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.clear();

  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });

  organizer = await createUser("RT Organizer", emails[0]);
  alpha = await createUser("RT Alpha", emails[1]);
  beta = await createUser("RT Beta", emails[2]);
  outsider = await createUser("RT Outsider", emails[3]);
});

after(async () => {
  for (const socket of openSockets) socket.disconnect();
  await closeSocketServer(ioServer);
  await new Promise((resolve) => httpServer.close(() => resolve()));
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });
  await disconnectDatabase();
});

test("rejects a socket without the auth cookie", async () => {
  const error = await expectConnectError(connect());
  assert.equal(error.message, "Authentication required");
});

test("ignores tokens passed in the URL query or auth payload (cookie-only authentication)", async () => {
  const token = tokenFor(organizer);
  const error = await expectConnectError(connect({ query: { token }, auth: { token } }));
  assert.equal(error.message, "Authentication required");
});

test("rejects an invalid or expired token", async () => {
  const forged = await expectConnectError(connect({ cookie: `${AUTH_COOKIE_NAME}=not-a-jwt` }));
  assert.equal(forged.message, "Invalid or expired token");

  const expired = jwt.sign(
    { sub: organizer._id.toString(), email: organizer.email, name: organizer.name },
    TEST_JWT_SECRET,
    { algorithm: "HS256", expiresIn: -10 },
  );
  const error = await expectConnectError(connect({ cookie: `${AUTH_COOKIE_NAME}=${expired}` }));
  assert.equal(error.message, "Invalid or expired token");
});

test("rejects a cookie-authenticated socket from a foreign Origin (cross-site WebSocket hijacking)", async () => {
  const socket = connect({
    cookie: `${AUTH_COOKIE_NAME}=${tokenFor(organizer)}`,
    origin: "https://evil.example",
  });
  const error = await expectConnectError(socket);
  assert.ok(error);
});

test("accepts an allowed Origin and confirms the authenticated user", async () => {
  const socket = connect({ cookie: `${AUTH_COOKIE_NAME}=${tokenFor(organizer)}` });
  const ready = await waitForEvent(socket, "session:ready");
  assert.equal(ready.userId, organizer._id.toString());
});

test("meeting confirmation notifies organizer and invitees only; resource broadcast carries no private data", async () => {
  const room = await Resource.create({
    name: "RT Room",
    type: "room",
    capacity: 4,
    createdBy: organizer._id,
  });

  const orgSocket = await connectAs(organizer);
  const alphaSocket = await connectAs(alpha);
  const outsiderSocket = await connectAs(outsider);
  const outsiderEvents = recordEvents(outsiderSocket);

  const confirmed = waitForEvent(orgSocket, "meeting:confirmed");
  const invited = waitForEvent(alphaSocket, "invitation:created");
  const bookingChanged = waitForEvent(outsiderSocket, "resource:booking-changed");

  const res = await api(organizer).post("/api/meetings/confirm", {
    title: "Secret roadmap review",
    startAt: "2026-12-10T10:00:00.000Z",
    endAt: "2026-12-10T11:00:00.000Z",
    participantEmails: [alpha.email],
    resourceId: room._id.toString(),
    attendeeCount: 2,
  });
  assert.equal(res.status, 201, res.body.message);

  const organizerPayload = await confirmed;
  assert.equal(organizerPayload.meeting.id, res.body.meeting.id);

  const invitePayload = await invited;
  assert.equal(invitePayload.meeting.id, res.body.meeting.id);
  assert.equal(invitePayload.meeting.participants[0].status, "pending");

  const broadcast = await bookingChanged;
  assert.deepEqual(Object.keys(broadcast).sort(), ["occurredAt", "resourceId"]);
  assert.equal(broadcast.resourceId, room._id.toString());

  await settle();
  assert.deepEqual(
    outsiderEvents.map((entry) => entry.eventName),
    ["resource:booking-changed"],
    "outsider must not receive meeting or invitation events",
  );
  assert.ok(!JSON.stringify(outsiderEvents).includes("Secret roadmap review"));
});

test("RSVP accept and decline notify every meeting member, including the organizer", async () => {
  const res = await api(organizer).post("/api/meetings/confirm", {
    title: "RSVP check",
    startAt: "2026-12-11T10:00:00.000Z",
    endAt: "2026-12-11T11:00:00.000Z",
    participantEmails: [alpha.email, beta.email],
  });
  const meetingId = res.body.meeting.id;

  const orgSocket = await connectAs(organizer);
  const betaSocket = await connectAs(beta);
  const outsiderEvents = recordEvents(await connectAs(outsider));

  const accepted = waitForEvent(orgSocket, "invitation:accepted");
  const betaSeesAccept = waitForEvent(betaSocket, "invitation:accepted");
  await api(alpha).patch(`/api/meetings/${meetingId}/invitation-response`, { status: "accepted" }).expect(200);

  const acceptPayload = await accepted;
  assert.equal(acceptPayload.responderId, alpha._id.toString());
  assert.equal(acceptPayload.status, "accepted");
  await betaSeesAccept;

  const declined = waitForEvent(orgSocket, "invitation:declined");
  await api(beta).patch(`/api/meetings/${meetingId}/invitation-response`, { status: "declined" }).expect(200);
  const declinePayload = await declined;
  assert.equal(declinePayload.responderId, beta._id.toString());

  await settle();
  assert.equal(outsiderEvents.length, 0);
});

test("cancellation notifies all meeting members", async () => {
  const res = await api(organizer).post("/api/meetings/confirm", {
    title: "To cancel",
    startAt: "2026-12-12T10:00:00.000Z",
    endAt: "2026-12-12T11:00:00.000Z",
    participantEmails: [alpha.email],
  });

  const alphaSocket = await connectAs(alpha);
  const orgSocket = await connectAs(organizer);
  const alphaCancelled = waitForEvent(alphaSocket, "meeting:cancelled");
  const orgCancelled = waitForEvent(orgSocket, "meeting:cancelled");

  await api(organizer).post(`/api/meetings/${res.body.meeting.id}/cancel`).expect(200);

  assert.equal((await alphaCancelled).meeting.status, "cancelled");
  assert.equal((await orgCancelled).meeting.id, res.body.meeting.id);
});

test("moving a shared meeting notifies members with meeting:updated", async () => {
  const res = await api(organizer).post("/api/meetings/confirm", {
    title: "Movable",
    startAt: "2026-12-13T10:00:00.000Z",
    endAt: "2026-12-13T11:00:00.000Z",
    participantEmails: [alpha.email],
  });

  const alphaSocket = await connectAs(alpha);
  const updated = waitForEvent(alphaSocket, "meeting:updated");

  await api(organizer)
    .patch(`/api/events/${res.body.meeting.id}`, {
      startAt: "2026-12-13T12:00:00.000Z",
      endAt: "2026-12-13T13:00:00.000Z",
    })
    .expect(200);

  assert.equal((await updated).meeting.startAt, "2026-12-13T12:00:00.000Z");
});

test("personal event create/update/delete reach the owner's tabs only", async () => {
  const tabOne = await connectAs(organizer);
  const tabTwo = await connectAs(organizer);
  const outsiderEvents = recordEvents(await connectAs(outsider));

  const createdOne = waitForEvent(tabOne, "event:created");
  const createdTwo = waitForEvent(tabTwo, "event:created");
  const created = await api(organizer).post("/api/events", {
    title: "Private focus time",
    startAt: "2026-12-14T10:00:00.000Z",
    endAt: "2026-12-14T11:00:00.000Z",
  });
  assert.equal(created.status, 201);
  assert.equal((await createdOne).event.id, created.body.event.id);
  await createdTwo;

  const updated = waitForEvent(tabOne, "event:updated");
  await api(organizer).patch(`/api/events/${created.body.event.id}`, { title: "Deep work" }).expect(200);
  assert.equal((await updated).event.title, "Deep work");

  const deleted = waitForEvent(tabTwo, "event:deleted");
  await api(organizer).del(`/api/events/${created.body.event.id}`).expect(200);
  assert.equal((await deleted).eventId, created.body.event.id);

  await settle();
  assert.equal(outsiderEvents.length, 0);
});

test("a failed (rolled back) booking emits nothing", async () => {
  const room = await Resource.create({ name: "RT Busy", type: "room", capacity: 4, createdBy: organizer._id });
  await api(organizer)
    .post("/api/events", {
      title: "First",
      startAt: "2026-12-15T10:00:00.000Z",
      endAt: "2026-12-15T11:00:00.000Z",
      resourceId: room._id.toString(),
    })
    .expect(201);

  const outsiderSocket = await connectAs(outsider);
  const outsiderEvents = recordEvents(outsiderSocket);

  const conflict = await api(outsider).post("/api/events", {
    title: "Second",
    startAt: "2026-12-15T10:30:00.000Z",
    endAt: "2026-12-15T11:30:00.000Z",
    resourceId: room._id.toString(),
  });
  assert.equal(conflict.status, 409);

  await settle();
  assert.equal(outsiderEvents.length, 0);
});

test("resource catalogue changes are broadcast to authenticated users", async () => {
  const alphaSocket = await connectAs(alpha);
  const created = waitForEvent(alphaSocket, "resource:created");

  const res = await api(organizer).post("/api/resources", { name: "RT Projector", type: "equipment", capacity: 1 });
  assert.equal(res.status, 201);
  assert.equal((await created).resource.name, "RT Projector");

  const deactivated = waitForEvent(alphaSocket, "resource:deactivated");
  await api(organizer).del(`/api/resources/${res.body.resource.id}`).expect(200);
  assert.equal((await deactivated).resource.isActive, false);
});

test("clients cannot subscribe themselves to another user's room", async () => {
  const outsiderSocket = await connectAs(outsider);
  const outsiderEvents = recordEvents(outsiderSocket);
  outsiderSocket.emit("join", `user:${organizer._id}`);
  outsiderSocket.emit("subscribe", { room: `user:${organizer._id}` });
  await settle(100);

  await api(organizer)
    .post("/api/events", {
      title: "Organizer only",
      startAt: "2026-12-16T10:00:00.000Z",
      endAt: "2026-12-16T11:00:00.000Z",
    })
    .expect(201);

  await settle();
  assert.equal(outsiderEvents.length, 0);
});

test("the server disconnects a socket when its session token expires", async () => {
  const shortLived = jwt.sign(
    { sub: alpha._id.toString(), email: alpha.email, name: alpha.name },
    TEST_JWT_SECRET,
    { algorithm: "HS256", expiresIn: 2 },
  );
  const socket = connect({ cookie: `${AUTH_COOKIE_NAME}=${shortLived}` });
  await waitForEvent(socket, "session:ready");

  const expired = waitForEvent(socket, "session:expired", 5000);
  const disconnected = waitForEvent(socket, "disconnect", 5000);

  assert.equal((await expired).reason, "token_expired");
  assert.equal(await disconnected, "io server disconnect");
});
