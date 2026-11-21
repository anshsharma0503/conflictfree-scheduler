import test from "node:test";
import assert from "node:assert/strict";
import { getAllowedOrigins } from "../src/config/origins.js";
import { isOriginAllowed, parseCookieHeader } from "../src/realtime/socketServer.js";
import {
  emitToUsers,
  getRealtimeServer,
  setRealtimeServer,
  userRoom,
} from "../src/realtime/realtimeService.js";
import { getMeetingMemberIds } from "../src/services/schedulingEvents.js";

test("parseCookieHeader reads named cookies and tolerates malformed parts", () => {
  assert.deepEqual(parseCookieHeader("a=1; conflictfree_token=abc.def; junk; b=%20x"), {
    a: "1",
    conflictfree_token: "abc.def",
    b: " x",
  });
  assert.deepEqual(parseCookieHeader(undefined), {});
});

test("getAllowedOrigins includes FRONTEND_URL, CORS_ORIGINS and the loopback twin outside production", () => {
  const dev = getAllowedOrigins({
    FRONTEND_URL: "http://localhost:5173/",
    CORS_ORIGINS: "https://staging.example.com, not a url",
    NODE_ENV: "development",
  });

  assert.deepEqual(dev.sort(), [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://staging.example.com",
  ]);

  const prod = getAllowedOrigins({
    FRONTEND_URL: "https://app.example.com",
    NODE_ENV: "production",
  });
  assert.deepEqual(prod, ["https://app.example.com"]);
});

test("isOriginAllowed allows listed origins and non-browser clients, rejects others", () => {
  const allowed = ["http://localhost:5173"];
  assert.equal(isOriginAllowed("http://localhost:5173", allowed), true);
  assert.equal(isOriginAllowed(undefined, allowed), true);
  assert.equal(isOriginAllowed("https://evil.example", allowed), false);
  assert.equal(isOriginAllowed("http://localhost:5173.evil.example", allowed), false);
});

test("getMeetingMemberIds returns the organizer plus registered participants, deduplicated", () => {
  const ids = getMeetingMemberIds({
    owner: "org",
    participants: [
      { user: "a", status: "pending" },
      { user: "b", status: "declined" },
      { user: null, email: "unregistered@example.com" },
      { user: "a", status: "accepted" },
    ],
  });

  assert.deepEqual(ids, ["org", "a", "b"]);
});

test("emitToUsers targets only private user rooms and is a no-op without a server", () => {
  const previous = getRealtimeServer();
  const calls = [];

  setRealtimeServer(null);
  assert.doesNotThrow(() => emitToUsers(["x"], "event:created", {}));

  setRealtimeServer({
    to(rooms) {
      return {
        emit(eventName, payload) {
          calls.push({ rooms, eventName, payload });
        },
      };
    },
  });

  emitToUsers(["u1", "u1", null, "u2"], "event:created", { event: { id: "e1" } });
  setRealtimeServer(previous);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].rooms, [userRoom("u1"), userRoom("u2")]);
  assert.equal(calls[0].eventName, "event:created");
  assert.equal(calls[0].payload.event.id, "e1");
  assert.ok(calls[0].payload.occurredAt);
});
