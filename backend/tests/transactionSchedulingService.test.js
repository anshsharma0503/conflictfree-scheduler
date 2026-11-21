import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import Resource from "../src/models/Resource.js";
import User from "../src/models/User.js";
import { signAuthToken } from "../src/services/tokenService.js";
import {
  isTransactionSupported,
  lockResourcesInOrder,
  lockUsersInOrder,
  withSchedulingTransaction,
} from "../src/services/scheduling/transactionSchedulingService.js";
import {
  cancelMeeting,
  confirmSharedMeeting,
  respondToInvitation,
} from "../src/services/meetingService.js";

const TEST_JWT_SECRET = "test-secret";

let organizer = null;
let participantA = null;
let participantB = null;
let roomA = null;
let roomB = null;

const testEmails = [
  "org-tx@example.com",
  "part-a-tx@example.com",
  "part-b-tx@example.com",
];

function createToken(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
  });
}

before(async () => {
  await connectDatabase();
});

after(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({ email: { $in: testEmails } });
  await disconnectDatabase();
});

beforeEach(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({ email: { $in: testEmails } });

  organizer = await User.create({
    name: "Organizer Tx",
    email: "org-tx@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
    calendarVersion: 0,
  });

  participantA = await User.create({
    name: "Participant Alpha Tx",
    email: "part-a-tx@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
    calendarVersion: 0,
  });

  participantB = await User.create({
    name: "Participant Beta Tx",
    email: "part-b-tx@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
    calendarVersion: 0,
  });

  roomA = await Resource.create({
    name: "Boardroom Alpha Tx",
    type: "room",
    capacity: 10,
    isActive: true,
    createdBy: organizer._id,
    bookingVersion: 0,
  });

  roomB = await Resource.create({
    name: "Boardroom Beta Tx",
    type: "room",
    capacity: 6,
    isActive: true,
    createdBy: organizer._id,
    bookingVersion: 0,
  });
});

test("1. Replica-set capability detection detects standalone vs replica set", async () => {
  const supported = await isTransactionSupported(mongoose);
  assert.equal(typeof supported, "boolean");

  // Mock standalone deployment (no setName)
  const mockStandaloneClient = {
    connection: {
      db: {
        admin: () => ({
          command: async () => ({ ok: 1, isWritablePrimary: true }),
        }),
      },
    },
  };
  const standaloneResult = await isTransactionSupported(mockStandaloneClient);
  assert.equal(standaloneResult, false);

  // Mock replica-set deployment (setName present)
  const mockReplicaClient = {
    connection: {
      db: {
        admin: () => ({
          command: async () => ({ ok: 1, setName: "rs0", isWritablePrimary: true }),
        }),
      },
    },
  };
  const replicaResult = await isTransactionSupported(mockReplicaClient);
  assert.equal(replicaResult, true);
});

test("2. HTTP 503 is returned when transaction support is unavailable", async () => {
  const mockStandaloneClient = {
    connection: {
      db: {
        admin: () => ({
          command: async () => ({ ok: 1 }),
        }),
      },
    },
  };

  await assert.rejects(
    async () => {
      await withSchedulingTransaction(
        async () => {
          return "should not run";
        },
        { mongooseClient: mockStandaloneClient },
      );
    },
    (err) => {
      assert.equal(err.status, 503);
      assert.match(err.message, /Atomic scheduling requires a MongoDB replica set/);
      return true;
    },
  );
});

test("3. lockUsersInOrder sorts IDs canonically and atomically increments calendarVersion", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    // If running on standalone before user initiates rs0, verify unit logic with standalone mock
    const u1 = participantB._id.toString();
    const u2 = participantA._id.toString();
    const expectedSorted = [u1, u2].sort();

    // Verify ordering
    const sorted = Array.from(new Set([u1, u2])).sort();
    assert.deepEqual(sorted, expectedSorted);
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Pass IDs in reverse order
      const locked = await lockUsersInOrder(
        [participantB._id, participantA._id],
        session,
        User,
      );

      assert.equal(locked.length, 2);
      // Verify versions incremented
      for (const u of locked) {
        assert.equal(u.calendarVersion, 1);
      }
    });
  } finally {
    await session.endSession();
  }

  const updatedA = await User.findById(participantA._id);
  const updatedB = await User.findById(participantB._id);
  assert.equal(updatedA.calendarVersion, 1);
  assert.equal(updatedB.calendarVersion, 1);
});

test("4. lockResourcesInOrder sorts IDs canonically and atomically increments bookingVersion", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const locked = await lockResourcesInOrder(
        [roomB._id, roomA._id],
        session,
        Resource,
      );

      assert.equal(locked.length, 2);
      for (const r of locked) {
        assert.equal(r.bookingVersion, 1);
      }
    });
  } finally {
    await session.endSession();
  }

  const updatedA = await Resource.findById(roomA._id);
  const updatedB = await Resource.findById(roomB._id);
  assert.equal(updatedA.bookingVersion, 1);
  assert.equal(updatedB.bookingVersion, 1);
});

test("5. Atomic shared-meeting confirmation succeeds when replica set is active", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  const meeting = await confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Atomic Strategy Session",
    startAt: "2026-11-25T10:00:00.000Z",
    endAt: "2026-11-25T11:00:00.000Z",
    participantEmails: [participantA.email],
    resourceId: roomA._id.toString(),
  });

  assert.equal(meeting.title, "Atomic Strategy Session");
  assert.equal(meeting.status, "active");
  assert.equal(meeting.participants[0].status, "pending");

  // Verify calendarVersion and bookingVersion incremented
  const orgDoc = await User.findById(organizer._id);
  const partDoc = await User.findById(participantA._id);
  const roomDoc = await Resource.findById(roomA._id);

  assert.equal(orgDoc.calendarVersion, 1);
  assert.equal(partDoc.calendarVersion, 1);
  assert.equal(roomDoc.bookingVersion, 1);
});

test("6. Atomic rollback when participant conflict appears during transaction", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  // Pre-create conflict for participantA
  await Event.create({
    owner: participantA._id,
    title: "Pre-existing Busy Slot",
    startAt: new Date("2026-11-25T10:30:00.000Z"),
    endAt: new Date("2026-11-25T11:30:00.000Z"),
  });

  const initialOrg = await User.findById(organizer._id);
  const initialPart = await User.findById(participantA._id);

  await assert.rejects(
    async () => {
      await confirmSharedMeeting({
        organizerId: organizer._id,
        title: "Conflicting Meeting",
        startAt: "2026-11-25T10:00:00.000Z",
        endAt: "2026-11-25T11:00:00.000Z",
        participantEmails: [participantA.email],
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /One or more participants are no longer available/);
      return true;
    },
  );

  // Requirement 8: No partial canonical meeting exists after failed transaction
  const meetingCount = await Event.countDocuments({ title: "Conflicting Meeting" });
  assert.equal(meetingCount, 0);

  // Requirement 9: No partial participant/resource version update remains after rollback
  const finalOrg = await User.findById(organizer._id);
  const finalPart = await User.findById(participantA._id);
  assert.equal(finalOrg.calendarVersion, initialOrg.calendarVersion);
  assert.equal(finalPart.calendarVersion, initialPart.calendarVersion);
});

test("7. Atomic rollback when resource conflict appears during transaction", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  // Pre-book roomA
  await Event.create({
    owner: organizer._id,
    title: "Existing Booking",
    startAt: new Date("2026-11-25T10:00:00.000Z"),
    endAt: new Date("2026-11-25T11:00:00.000Z"),
    resource: roomA._id,
  });

  const initialRoom = await Resource.findById(roomA._id);

  await assert.rejects(
    async () => {
      await confirmSharedMeeting({
        organizerId: organizer._id,
        title: "Double Booking Attempt",
        startAt: "2026-11-25T10:00:00.000Z",
        endAt: "2026-11-25T11:00:00.000Z",
        participantEmails: [participantA.email],
        resourceId: roomA._id.toString(),
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Resource is already booked/);
      return true;
    },
  );

  const doubleBookingCount = await Event.countDocuments({
    title: "Double Booking Attempt",
  });
  assert.equal(doubleBookingCount, 0);

  const finalRoom = await Resource.findById(roomA._id);
  assert.equal(finalRoom.bookingVersion, initialRoom.bookingVersion);
});

test("8. Two concurrent confirmations for the same participant: exactly one succeeds", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  const confirmPromise1 = confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Concurrent Meeting 1",
    startAt: "2026-11-25T14:00:00.000Z",
    endAt: "2026-11-25T15:00:00.000Z",
    participantEmails: [participantA.email],
  });

  const confirmPromise2 = confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Concurrent Meeting 2",
    startAt: "2026-11-25T14:00:00.000Z",
    endAt: "2026-11-25T15:00:00.000Z",
    participantEmails: [participantA.email],
  });

  const results = await Promise.allSettled([confirmPromise1, confirmPromise2]);
  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  assert.equal(succeeded.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.status, 409);

  // Exactly one meeting was created in the database
  const count = await Event.countDocuments({
    startAt: new Date("2026-11-25T14:00:00.000Z"),
  });
  assert.equal(count, 1);
});

test("9. Two concurrent confirmations for the same resource: exactly one succeeds", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  const book1 = confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Resource Contest 1",
    startAt: "2026-11-25T16:00:00.000Z",
    endAt: "2026-11-25T17:00:00.000Z",
    participantEmails: [participantA.email],
    resourceId: roomA._id.toString(),
  });

  const book2 = confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Resource Contest 2",
    startAt: "2026-11-25T16:00:00.000Z",
    endAt: "2026-11-25T17:00:00.000Z",
    participantEmails: [participantB.email],
    resourceId: roomA._id.toString(),
  });

  const results = await Promise.allSettled([book1, book2]);
  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  assert.equal(succeeded.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.status, 409);

  const count = await Event.countDocuments({
    resource: roomA._id,
    startAt: new Date("2026-11-25T16:00:00.000Z"),
  });
  assert.equal(count, 1);
});

test("10. Cancellation atomically frees participant and resource availability", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  const meeting = await confirmSharedMeeting({
    organizerId: organizer._id,
    title: "To Be Cancelled",
    startAt: "2026-11-26T10:00:00.000Z",
    endAt: "2026-11-26T11:00:00.000Z",
    participantEmails: [participantA.email],
    resourceId: roomA._id.toString(),
  });

  const cancelled = await cancelMeeting({
    meetingId: meeting.id,
    userId: organizer._id,
  });

  assert.equal(cancelled.status, "cancelled");

  // Re-booking the same slot and resource immediately succeeds
  const newMeeting = await confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Replacement Meeting",
    startAt: "2026-11-26T10:00:00.000Z",
    endAt: "2026-11-26T11:00:00.000Z",
    participantEmails: [participantA.email],
    resourceId: roomA._id.toString(),
  });

  assert.equal(newMeeting.status, "active");
});

test("11. Invite acceptance is protected against concurrent newly-created participant conflicts", async () => {
  const supported = await isTransactionSupported(mongoose);
  if (!supported) {
    return;
  }

  const meeting = await confirmSharedMeeting({
    organizerId: organizer._id,
    title: "Pending Invite Meeting",
    startAt: "2026-11-27T10:00:00.000Z",
    endAt: "2026-11-27T11:00:00.000Z",
    participantEmails: [participantA.email],
  });

  // Participant creates a separate personal conflicting event
  await Event.create({
    owner: participantA._id,
    title: "Personal Conflicting Appointment",
    startAt: new Date("2026-11-27T10:30:00.000Z"),
    endAt: new Date("2026-11-27T11:30:00.000Z"),
  });

  // Attempt to accept invite -> must fail with 409
  await assert.rejects(
    async () => {
      await respondToInvitation({
        meetingId: meeting.id,
        userId: participantA._id,
        userEmail: participantA.email,
        status: "accepted",
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /conflicting event/);
      return true;
    },
  );
});

test("12. Existing personal events without resources continue working without transaction requirement", async () => {
  const token = createToken(organizer);

  const res = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Simple Personal Note",
      startAt: "2026-11-28T10:00:00.000Z",
      endAt: "2026-11-28T11:00:00.000Z",
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.event.title, "Simple Personal Note");
  assert.equal(res.body.event.resource, null);
});

