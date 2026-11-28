import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import User from "../src/models/User.js";

const emails = ["tz-ist@example.com", "tz-bad@example.com", "tz-none@example.com"];

before(async () => {
  process.env.JWT_SECRET = "test-secret";
  await connectDatabase();
});

beforeEach(async () => {
  await User.deleteMany({ email: { $in: emails } });
});

after(async () => {
  await User.deleteMany({ email: { $in: emails } });
  await disconnectDatabase();
});

function register(email, timezone) {
  return request(app)
    .post("/api/auth/register")
    .send({ name: "Zone Tester", email, password: "Password123!", ...(timezone !== undefined ? { timezone } : {}) });
}

test("registration stores the browser's IANA timezone", async () => {
  const response = await register(emails[0], " Asia/Kolkata ");

  assert.equal(response.status, 201);
  assert.equal(response.body.user.timezone, "Asia/Kolkata");
  assert.equal((await User.findOne({ email: emails[0] }).lean()).timezone, "Asia/Kolkata");
});

test("an invalid or missing timezone falls back to UTC instead of failing sign-up", async () => {
  const bad = await register(emails[1], "Mars/Olympus_Mons");
  assert.equal(bad.status, 201);
  assert.equal(bad.body.user.timezone, "UTC");

  const missing = await register(emails[2]);
  assert.equal(missing.status, 201);
  assert.equal(missing.body.user.timezone, "UTC");
});

test("PATCH /api/auth/me changes the timezone; invalid values are rejected", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ name: "Zone Tester", email: emails[0], password: "Password123!" });

  const updated = await agent.patch("/api/auth/me").send({ timezone: "Asia/Kolkata" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.timezone, "Asia/Kolkata");

  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.timezone, "Asia/Kolkata");

  for (const timezone of ["", "Not/AZone", 5, null]) {
    const rejected = await agent.patch("/api/auth/me").send({ timezone });
    assert.equal(rejected.status, 400, JSON.stringify(timezone));
  }
  assert.equal((await User.findOne({ email: emails[0] }).lean()).timezone, "Asia/Kolkata");
});

test("PATCH /api/auth/me requires authentication", async () => {
  const response = await request(app).patch("/api/auth/me").send({ timezone: "Asia/Kolkata" });
  assert.equal(response.status, 401);
});
