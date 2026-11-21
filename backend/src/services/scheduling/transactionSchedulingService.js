import mongoose from "mongoose";
import User from "../../models/User.js";
import Resource from "../../models/Resource.js";

/**
 * Detects whether the active MongoDB connection supports multi-document transactions.
 * Transactions require a replica set deployment (indicated by setName in db.hello()).
 */
export async function isTransactionSupported(mongooseClient = mongoose) {
  try {
    const adminDb = mongooseClient.connection.db?.admin();
    if (!adminDb) {
      return false;
    }
    const hello = await adminDb.command({ hello: 1 });
    return Boolean(hello && hello.setName);
  } catch {
    return false;
  }
}

/**
 * Executes an operation inside a MongoDB transaction with write-conflict retry.
 * Throws HTTP 503 if transactions are not supported by the deployment.
 * Never silently falls back to a non-atomic write.
 */
export async function withSchedulingTransaction(
  operationFn,
  { mongooseClient = mongoose } = {},
) {
  const supported = await isTransactionSupported(mongooseClient);

  if (!supported) {
    const error = new Error("Atomic scheduling requires a MongoDB replica set.");
    error.status = 503;
    throw error;
  }

  const session = await mongooseClient.startSession();

  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await operationFn(session);
      },
      {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      },
    );

    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Locks a set of users in stable sorted ObjectId order by atomically incrementing their calendarVersion.
 * This forces concurrent transactions on any overlapping participant to experience a write conflict.
 */
export async function lockUsersInOrder(
  userIds = [],
  session,
  UserModel = User,
) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  // Deduplicate and sort IDs canonically (alphabetically by hex string) to guarantee deadlock-free ordering
  const sortedIds = Array.from(
    new Set(userIds.map((id) => (id?._id ? id._id.toString() : id.toString()))),
  ).sort();

  const lockedUsers = [];

  for (const idStr of sortedIds) {
    const user = await UserModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(idStr) },
      { $inc: { calendarVersion: 1 } },
      { session, returnDocument: "after" },
    );

    if (user) {
      lockedUsers.push(user);
    }
  }

  return lockedUsers;
}

/**
 * Locks a set of resources in stable sorted ObjectId order by atomically incrementing their bookingVersion.
 * This forces concurrent transactions reserving the same resource to experience a write conflict.
 */
export async function lockResourcesInOrder(
  resourceIds = [],
  session,
  ResourceModel = Resource,
) {
  if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
    return [];
  }

  const validIds = resourceIds
    .filter(Boolean)
    .map((id) => (id?._id ? id._id.toString() : id.toString()));

  const sortedIds = Array.from(new Set(validIds)).sort();

  const lockedResources = [];

  for (const idStr of sortedIds) {
    const resource = await ResourceModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(idStr) },
      { $inc: { bookingVersion: 1 } },
      { session, returnDocument: "after" },
    );

    if (resource) {
      lockedResources.push(resource);
    }
  }

  return lockedResources;
}

