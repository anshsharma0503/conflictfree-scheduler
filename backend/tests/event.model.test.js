import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Event from "../src/models/Event.js";

test("Event model accepts a valid manual event", async () => {
  const ownerId = new mongoose.Types.ObjectId();

  const event = new Event({
    owner: ownerId,
    title: " Planning Meeting ",
    description: " Discuss project roadmap ",
    startAt: new Date("2026-08-10T10:00:00.000Z"),
    endAt: new Date("2026-08-10T11:00:00.000Z"),
    timezone: " Asia/Kolkata ",
    location: " Room 301 ",
    participants: [
      {
        email: " ALEX@EXAMPLE.COM ",
        name: " Alex ",
      },
    ],
  });

  await event.validate();

  assert.equal(event.owner.toString(), ownerId.toString());
  assert.equal(event.title, "Planning Meeting");
  assert.equal(event.description, "Discuss project roadmap");
  assert.equal(event.timezone, "Asia/Kolkata");
  assert.equal(event.location, "Room 301");
  assert.equal(event.source, "manual");
  assert.equal(event.participants[0].email, "alex@example.com");
  assert.equal(event.participants[0].name, "Alex");
  assert.equal(event.participants[0].status, "pending");
});

test("Event model requires owner, title, startAt, and endAt", async () => {
  const event = new Event({});

  await assert.rejects(() => event.validate(), {
    name: "ValidationError",
  });
});

test("Event model rejects an end time equal to start time", async () => {
  const event = new Event({
    owner: new mongoose.Types.ObjectId(),
    title: "Invalid Meeting",
    startAt: new Date("2026-08-10T10:00:00.000Z"),
    endAt: new Date("2026-08-10T10:00:00.000Z"),
  });

  await assert.rejects(() => event.validate(), {
    name: "ValidationError",
  });
});

test("Event model rejects an end time before start time", async () => {
  const event = new Event({
    owner: new mongoose.Types.ObjectId(),
    title: "Invalid Meeting",
    startAt: new Date("2026-08-10T11:00:00.000Z"),
    endAt: new Date("2026-08-10T10:00:00.000Z"),
  });

  await assert.rejects(() => event.validate(), {
    name: "ValidationError",
  });
});

test("Event model rejects unsupported participant status", async () => {
  const event = new Event({
    owner: new mongoose.Types.ObjectId(),
    title: "Planning Meeting",
    startAt: new Date("2026-08-10T10:00:00.000Z"),
    endAt: new Date("2026-08-10T11:00:00.000Z"),
    participants: [
      {
        email: "alex@example.com",
        status: "maybe",
      },
    ],
  });

  await assert.rejects(() => event.validate(), {
    name: "ValidationError",
  });
});

test("Event model rejects invalid participant email", async () => {
  const event = new Event({
    owner: new mongoose.Types.ObjectId(),
    title: "Planning Meeting",
    startAt: new Date("2026-08-10T10:00:00.000Z"),
    endAt: new Date("2026-08-10T11:00:00.000Z"),
    participants: [
      {
        email: "not-an-email",
      },
    ],
  });

  await assert.rejects(() => event.validate(), {
    name: "ValidationError",
  });
});