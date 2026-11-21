import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Resource from "../src/models/Resource.js";
import User from "../src/models/User.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";

let creatorUser = null;
let otherUser = null;

before(async () => {
  await connectDatabase();
});

beforeEach(async () => {
  await Resource.deleteMany({});
  await User.deleteMany({
    email: { $in: ["creator@example.com", "other@example.com"] },
  });

  creatorUser = await User.create({
    name: "Resource Creator",
    email: "creator@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  otherUser = await User.create({
    name: "Other User",
    email: "other@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });
});

after(async () => {
  await Resource.deleteMany({});
  await User.deleteMany({
    email: { $in: ["creator@example.com", "other@example.com"] },
  });
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

test("POST /api/resources requires authentication", async () => {
  const response = await request(app).post("/api/resources").send({
    name: "Main Boardroom",
    type: "room",
    capacity: 12,
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test("POST /api/resources creates room resource successfully", async () => {
  const token = createAuthToken(creatorUser);

  const response = await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Main Boardroom",
      type: "room",
      capacity: 12,
      location: "Building A, Room 301",
      description: "Executive boardroom with AV equipment",
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.resource.name, "Main Boardroom");
  assert.equal(response.body.resource.type, "room");
  assert.equal(response.body.resource.capacity, 12);
  assert.equal(response.body.resource.location, "Building A, Room 301");
  assert.equal(response.body.resource.isActive, true);
  assert.equal(response.body.resource.createdBy, creatorUser._id.toString());
});

test("POST /api/resources rejects duplicate name case-insensitively", async () => {
  const token = createAuthToken(creatorUser);

  await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Focus Room 1",
      type: "room",
      capacity: 4,
    });

  const response = await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "FOCUS ROOM 1",
      type: "room",
      capacity: 4,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /already exists/i);
});

test("POST /api/resources validates required fields and capacity", async () => {
  const token = createAuthToken(creatorUser);

  // Missing name
  const missingNameRes = await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "room", capacity: 5 });
  assert.equal(missingNameRes.status, 400);

  // Invalid type
  const invalidTypeRes = await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Desk 1", type: "desk", capacity: 1 });
  assert.equal(invalidTypeRes.status, 400);

  // Invalid capacity (<= 0)
  const zeroCapRes = await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Desk 1", type: "room", capacity: 0 });
  assert.equal(zeroCapRes.status, 400);

  // Float capacity
  const floatCapRes = await request(app)
    .post("/api/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Desk 1", type: "room", capacity: 4.5 });
  assert.equal(floatCapRes.status, 400);
});

test("GET /api/resources lists active resources for any authenticated user, sorted by name", async () => {
  await Resource.create({
    name: "Zebra Room",
    type: "room",
    capacity: 6,
    createdBy: creatorUser._id,
    isActive: true,
  });
  await Resource.create({
    name: "Alpha Room",
    type: "room",
    capacity: 10,
    createdBy: creatorUser._id,
    isActive: true,
  });
  await Resource.create({
    name: "Deactivated Room",
    type: "room",
    capacity: 8,
    createdBy: creatorUser._id,
    isActive: false,
  });

  const otherToken = createAuthToken(otherUser);

  const response = await request(app)
    .get("/api/resources")
    .set("Authorization", `Bearer ${otherToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.resources.length, 2);
  assert.equal(response.body.resources[0].name, "Alpha Room");
  assert.equal(response.body.resources[1].name, "Zebra Room");
});

test("GET /api/resources/:id returns single resource or 404", async () => {
  const resource = await Resource.create({
    name: "Meeting Pod",
    type: "room",
    capacity: 2,
    createdBy: creatorUser._id,
  });

  const token = createAuthToken(otherUser);

  const successRes = await request(app)
    .get(`/api/resources/${resource._id}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(successRes.status, 200);
  assert.equal(successRes.body.resource.name, "Meeting Pod");

  const notFoundRes = await request(app)
    .get(`/api/resources/${new mongoose.Types.ObjectId()}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(notFoundRes.status, 404);
});

test("PATCH /api/resources/:id allows creator to edit, and rejects non-creator", async () => {
  const resource = await Resource.create({
    name: "Projector Beta",
    type: "equipment",
    capacity: 1,
    location: "Closet 1",
    createdBy: creatorUser._id,
  });

  const otherToken = createAuthToken(otherUser);
  const creatorToken = createAuthToken(creatorUser);

  // Non-creator edit rejected with 403
  const forbiddenRes = await request(app)
    .patch(`/api/resources/${resource._id}`)
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ location: "Room 101" });
  assert.equal(forbiddenRes.status, 403);

  // Creator edit succeeds
  const successRes = await request(app)
    .patch(`/api/resources/${resource._id}`)
    .set("Authorization", `Bearer ${creatorToken}`)
    .send({ location: "Room 101", capacity: 2 });
  assert.equal(successRes.status, 200);
  assert.equal(successRes.body.resource.location, "Room 101");
  assert.equal(successRes.body.resource.capacity, 2);
});

test("DELETE /api/resources/:id performs soft deactivation and enforces creator ownership", async () => {
  const resource = await Resource.create({
    name: "Testing Room",
    type: "room",
    capacity: 6,
    createdBy: creatorUser._id,
    isActive: true,
  });

  const otherToken = createAuthToken(otherUser);
  const creatorToken = createAuthToken(creatorUser);

  // Non-creator delete rejected with 403
  const forbiddenRes = await request(app)
    .delete(`/api/resources/${resource._id}`)
    .set("Authorization", `Bearer ${otherToken}`);
  assert.equal(forbiddenRes.status, 403);

  // Creator soft-delete
  const successRes = await request(app)
    .delete(`/api/resources/${resource._id}`)
    .set("Authorization", `Bearer ${creatorToken}`);
  assert.equal(successRes.status, 200);
  assert.equal(successRes.body.success, true);
  assert.equal(successRes.body.resource.isActive, false);

  // Verify in database that it was NOT physically deleted
  const dbResource = await Resource.findById(resource._id);
  assert.notEqual(dbResource, null);
  assert.equal(dbResource.isActive, false);
});

