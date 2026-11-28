import "dotenv/config";
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import User from "../src/models/User.js";
import { setAssistantClientForTests } from "../src/services/assistant/assistantService.js";
import { invalidateParticipantSearchCache } from "../src/services/search/participantSearchService.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const emails = ["as-org@example.com", "as-alex@example.com", "as-alexandra@example.com", "as-priya@example.com"];

let organizer;

function tokenFor(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({ id: user._id.toString(), email: user.email, name: user.name });
}

function parse(user, body) {
  return request(app)
    .post("/api/assistant/parse-request")
    .set("Authorization", `Bearer ${tokenFor(user)}`)
    .send(body);
}

function futureLocal(daysAhead, hour) {
  // Local wall-clock in Asia/Kolkata (UTC+5:30, no DST), always in the future.
  const date = new Date(Date.now() + daysAhead * 86_400_000 + 5.5 * 3_600_000);
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}

function fakeClient(data, calls = []) {
  return {
    model: "fake-model",
    async generateJson(payload) {
      calls.push(payload);
      return { data: typeof data === "function" ? data(payload) : data, model: "fake-model" };
    },
  };
}

function answer(overrides = {}) {
  return {
    intent: "schedule_meeting",
    title: "Design review",
    participants: ["Alex", "as-priya@example.com", "Nobody Here"],
    windowStart: futureLocal(2, 12),
    windowEnd: futureLocal(2, 17),
    durationMinutes: 45,
    preferredStartHour: -1,
    preferredEndHour: -1,
    avoidEarlyMorning: false,
    avoidLateDay: true,
    resourceType: "room",
    attendeeCount: 4,
    clarification: "",
    ...overrides,
  };
}

async function createUser(name, email, extra = {}) {
  return User.create({
    name,
    email,
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
    ...extra,
  });
}

before(async () => {
  await connectDatabase();
});

beforeEach(async () => {
  await User.deleteMany({ email: { $in: emails } });
  organizer = await createUser("Asha Organizer", emails[0], { timezone: "Asia/Kolkata" });
  await createUser("Alex Kumar", emails[1]);
  await createUser("Alexandra Lee", emails[2]);
  await createUser("Priya Shah", emails[3]);
  invalidateParticipantSearchCache();
});

afterEach(() => {
  setAssistantClientForTests(null);
});

after(async () => {
  await User.deleteMany({ email: { $in: emails } });
  invalidateParticipantSearchCache();
  await disconnectDatabase();
});

test("assistant routes require authentication", async () => {
  assert.equal((await request(app).get("/api/assistant/status")).status, 401);
  assert.equal((await request(app).post("/api/assistant/parse-request").send({ text: "hi there" })).status, 401);
});

test("without GEMINI_API_KEY the assistant reports disabled and parse answers 503", async () => {
  const status = await request(app)
    .get("/api/assistant/status")
    .set("Authorization", `Bearer ${tokenFor(organizer)}`);
  assert.deepEqual(status.body.assistant, { enabled: false, model: null });

  const response = await parse(organizer, { text: "Lunch with Priya tomorrow" });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /not configured/);
});

test("parses in the user's stored timezone and resolves people against real accounts", async () => {
  const calls = [];
  setAssistantClientForTests(fakeClient(answer(), calls));

  const response = await parse(organizer, {
    text: "Design review with Alex and as-priya@example.com, 45 min, Monday afternoon, need a room for 4",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.model, "fake-model");
  const draft = response.body.request;

  assert.equal(draft.timezone, "Asia/Kolkata");
  assert.equal(draft.windowStartLocal, futureLocal(2, 12));
  assert.equal(draft.durationMinutes, 45);
  assert.deepEqual(draft.preferences, { avoidLateDay: true });
  assert.deepEqual(draft.resource, { type: "room", attendeeCount: 4 });

  const byQuery = Object.fromEntries(draft.participants.map((p) => [p.query, p]));
  assert.equal(byQuery.Alex.status, "ambiguous");
  assert.deepEqual(byQuery.Alex.matches.map((m) => m.name).sort(), ["Alex Kumar", "Alexandra Lee"]);
  assert.equal(byQuery["as-priya@example.com"].status, "matched");
  assert.equal(byQuery["as-priya@example.com"].matches[0].name, "Priya Shah");
  assert.equal(byQuery["Nobody Here"].status, "not_found");
  assert.deepEqual(Object.keys(byQuery.Alex.matches[0]).sort(), ["email", "id", "name"], "no timezone or other fields");

  // The model gets the user's text and local context only — no user list.
  assert.match(calls[0].systemInstruction, /Asia\/Kolkata/);
  assert.ok(!calls[0].systemInstruction.includes("as-alex@example.com"));
  assert.ok(!calls[0].userText.includes("Alexandra"));
});

test("the requester is never returned as a participant", async () => {
  setAssistantClientForTests(fakeClient(answer({ participants: ["Asha Organizer", "as-org@example.com"] })));

  const response = await parse(organizer, { text: "meeting with myself and Asha" });

  assert.equal(response.status, 200);
  assert.ok(response.body.request.participants.every((p) => p.status === "not_found"));
});

test("invalid text is rejected before any model call", async () => {
  const calls = [];
  setAssistantClientForTests(fakeClient(answer(), calls));

  for (const body of [{}, { text: "" }, { text: "hi" }, { text: 12 }, { text: "x".repeat(501) }]) {
    const response = await parse(organizer, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal(calls.length, 0);
});

test("non-scheduling text and upstream failures return clear errors", async () => {
  setAssistantClientForTests(fakeClient(answer({ intent: "not_scheduling" })));
  const notScheduling = await parse(organizer, { text: "what is the capital of France" });
  assert.equal(notScheduling.status, 422);

  setAssistantClientForTests({
    model: "fake",
    async generateJson() {
      const error = new Error("The assistant is busy right now. Try again in a moment, or fill in the form yourself.");
      error.status = 503;
      throw error;
    },
  });
  const busy = await parse(organizer, { text: "lunch with Priya tomorrow" });
  assert.equal(busy.status, 503);
  assert.match(busy.body.message, /busy/);

  setAssistantClientForTests({
    model: "fake",
    async generateJson() {
      throw new Error("internal detail that must not leak");
    },
  });
  const crashed = await parse(organizer, { text: "lunch with Priya tomorrow" });
  assert.equal(crashed.status, 500);
  assert.ok(!crashed.body.message.includes("internal detail"));
});

test("each user gets 10 parses per minute, then 429 with Retry-After", async () => {
  setAssistantClientForTests(fakeClient(answer({ participants: [] })));
  const other = await User.findOne({ email: emails[1] });

  for (let index = 0; index < 10; index += 1) {
    assert.equal((await parse(organizer, { text: "sync tomorrow afternoon" })).status, 200);
  }

  const limited = await parse(organizer, { text: "sync tomorrow afternoon" });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers["retry-after"]) >= 1);

  assert.equal((await parse(other, { text: "sync tomorrow afternoon" })).status, 200, "limits are per user");
});

test("status reports the active model when configured", async () => {
  setAssistantClientForTests(fakeClient(answer()));

  const status = await request(app)
    .get("/api/assistant/status")
    .set("Authorization", `Bearer ${tokenFor(organizer)}`);

  assert.deepEqual(status.body.assistant, { enabled: true, model: "fake-model" });
});
