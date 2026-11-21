import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import User from "../src/models/User.js";
import { signAuthToken } from "../src/services/tokenService.js";
import { registerLocalUser } from "../src/services/authService.js";
import { invalidateParticipantSearchCache } from "../src/services/search/participantSearchService.js";

const TEST_JWT_SECRET = "test-secret";
const TEST_EMAILS = [
  "organizer.test@example.com",
  "raj.patel@example.com",
  "sarah.connor@example.com",
  "alex.smith@example.com",
  "new.user@example.com",
];

let organizerUser = null;
let participantUser1 = null;
let participantUser2 = null;

before(async () => {
  await connectDatabase();
});

beforeEach(async () => {
  invalidateParticipantSearchCache();
  await User.deleteMany({ email: { $in: TEST_EMAILS } });

  organizerUser = await User.create({
    name: "Organizer Raj",
    email: "organizer.test@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  participantUser1 = await User.create({
    name: "Raj Patel",
    email: "raj.patel@example.com",
    timezone: "Asia/Kolkata",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  participantUser2 = await User.create({
    name: "Sarah Connor",
    email: "sarah.connor@example.com",
    timezone: "America/New_York",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });
});

after(async () => {
  invalidateParticipantSearchCache();
  await User.deleteMany({ email: { $in: TEST_EMAILS } });
  await disconnectDatabase();
});

function createAuthToken(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
  });
}

test("GET /api/participants/search requires authentication", async () => {
  const response = await request(app).get("/api/participants/search?q=raj");
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test("GET /api/participants/search rejects missing or short queries", async () => {
  const token = createAuthToken(organizerUser);

  // Missing query
  const resMissing = await request(app)
    .get("/api/participants/search")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resMissing.status, 400);
  assert.equal(resMissing.body.success, false);

  // Single character
  const resShort = await request(app)
    .get("/api/participants/search?q=r")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resShort.status, 400);
  assert.equal(resShort.body.success, false);

  // Whitespace only
  const resWhitespace = await request(app)
    .get("/api/participants/search?q=   ")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resWhitespace.status, 400);
  assert.equal(resWhitespace.body.success, false);
});

test("GET /api/participants/search rejects invalid limit values", async () => {
  const token = createAuthToken(organizerUser);

  // Zero limit
  const resZero = await request(app)
    .get("/api/participants/search?q=raj&limit=0")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resZero.status, 400);
  assert.equal(resZero.body.success, false);

  // Negative limit
  const resNeg = await request(app)
    .get("/api/participants/search?q=raj&limit=-5")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resNeg.status, 400);

  // Over max limit (> 20)
  const resOver = await request(app)
    .get("/api/participants/search?q=raj&limit=25")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resOver.status, 400);

  // Non-numeric limit
  const resAlpha = await request(app)
    .get("/api/participants/search?q=raj&limit=ten")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resAlpha.status, 400);

  // Float limit
  const resFloat = await request(app)
    .get("/api/participants/search?q=raj&limit=5.5")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(resFloat.status, 400);
});

test("GET /api/participants/search returns empty list when no matches exist", async () => {
  const token = createAuthToken(organizerUser);

  const response = await request(app)
    .get("/api/participants/search?q=nonexistentuser")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.participants, []);
});

test("GET /api/participants/search excludes authenticated organizer from results", async () => {
  const token = createAuthToken(organizerUser);

  // Both organizer ("Organizer Raj") and participant ("Raj Patel") match "raj"
  const response = await request(app)
    .get("/api/participants/search?q=raj")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.participants.length, 1);
  assert.equal(response.body.participants[0].id, participantUser1._id.toString());
  assert.equal(response.body.participants[0].name, "Raj Patel");

  // Organizer must NOT be in results
  const foundOrganizer = response.body.participants.find(
    (p) => p.id === organizerUser._id.toString(),
  );
  assert.equal(foundOrganizer, undefined);
});

test("GET /api/participants/search returns only safe fields with no sensitive data", async () => {
  const token = createAuthToken(organizerUser);

  const response = await request(app)
    .get("/api/participants/search?q=sarah")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.participants.length, 1);

  const participant = response.body.participants[0];
  assert.equal(participant.id, participantUser2._id.toString());
  assert.equal(participant.name, "Sarah Connor");
  assert.equal(participant.email, "sarah.connor@example.com");
  assert.equal(participant.timezone, "America/New_York");

  // Assert sensitive fields are absent
  assert.equal(participant.passwordHash, undefined);
  assert.equal(participant.password, undefined);
  assert.equal(participant.googleId, undefined);
  assert.equal(participant.events, undefined);
});

test("A newly registered user appears in search after search-index refresh", async () => {
  const token = createAuthToken(organizerUser);

  // Search before new user registers
  const beforeRes = await request(app)
    .get("/api/participants/search?q=new")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(beforeRes.status, 200);
  assert.equal(beforeRes.body.participants.length, 0);

  // Register new user (which invalidates the Trie cache automatically)
  await registerLocalUser({
    name: "New Person",
    email: "new.user@example.com",
    password: "Password123!",
  });

  // Search after registration
  const afterRes = await request(app)
    .get("/api/participants/search?q=new")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(afterRes.status, 200);
  assert.equal(afterRes.body.participants.length, 1);
  assert.equal(afterRes.body.participants[0].name, "New Person");
  assert.equal(afterRes.body.participants[0].email, "new.user@example.com");
});

