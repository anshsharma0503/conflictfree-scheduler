// One-time helper: turns a freshly started `mongod --replSet rs0` into a
// working single-node replica set (needed for ConflictFree's atomic
// scheduling transactions). Safe to run again: it reports if already done.
//
// Usage (from backend/):  npm run db:init-replset
import { MongoClient } from "mongodb";

const host = process.env.MONGO_HOST || "127.0.0.1:27017";
const client = new MongoClient(`mongodb://${host}/?directConnection=true`, {
  serverSelectionTimeoutMS: 5000,
});

try {
  await client.connect();
  const admin = client.db("admin");

  try {
    await admin.command({
      replSetInitiate: { _id: "rs0", members: [{ _id: 0, host }] },
    });
    console.log("Replica set rs0 initiated.");
  } catch (error) {
    if (error.codeName === "AlreadyInitialized") {
      console.log("Replica set is already initialized.");
    } else if (error.codeName === "NoReplicationEnabled") {
      console.error(
        "MongoDB is not running with replication enabled. Add `replication: replSetName: rs0` " +
          "to mongod.cfg (or start mongod with --replSet rs0), restart MongoDB, then run this again.",
      );
      process.exitCode = 1;
    } else {
      throw error;
    }
  }

  if (!process.exitCode) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const hello = await admin.command({ hello: 1 });

      if (hello.isWritablePrimary && hello.setName === "rs0") {
        console.log(`Ready: replica set "${hello.setName}" primary at ${host}.`);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
} catch (error) {
  console.error(`Could not reach MongoDB at ${host}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
