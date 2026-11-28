import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_BULLMQ_PREFIX, E2E_MONGODB_URI, E2E_REDIS_URL } from "./e2eEnv.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Reuse the backend's MongoDB driver instead of adding a frontend dependency.
const requireFromBackend = createRequire(path.join(here, "../../backend/package.json"));

/**
 * Starts every E2E run from an empty, dedicated database so results never
 * depend on (or pollute) development data. Refuses to drop anything whose
 * name does not end in "_e2e".
 */
export default async function globalSetup() {
  const databaseName = new URL(E2E_MONGODB_URI).pathname.replace(/^\//, "");

  if (!databaseName.endsWith("_e2e")) {
    throw new Error(`Refusing to reset non-E2E database "${databaseName}"`);
  }

  const { MongoClient } = requireFromBackend("mongodb");
  const client = new MongoClient(E2E_MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db(databaseName);

    // Clear documents rather than dropping the database: this only needs
    // read/write permission (e.g. a MongoDB Atlas "readWrite" user) and
    // keeps the indexes the app relies on.
    for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (!name.startsWith("system.")) {
        await db.collection(name).deleteMany({});
      }
    }
  } finally {
    await client.close();
  }

  await resetE2eQueues();
}

/**
 * Removes every BullMQ key under the E2E prefix, so no job or reminder
 * schedule from an earlier run leaks into this one. Only keys matching
 * "<prefix>:*" are deleted, and the prefix must end in "e2e".
 */
async function resetE2eQueues() {
  if (!E2E_BULLMQ_PREFIX.endsWith("e2e")) {
    throw new Error(`Refusing to reset non-E2E BullMQ prefix "${E2E_BULLMQ_PREFIX}"`);
  }

  const IORedis = requireFromBackend("ioredis");
  const redis = new IORedis(E2E_REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000 });

  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${E2E_BULLMQ_PREFIX}:*`, "COUNT", 500);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    throw new Error(
      `E2E needs Redis at ${E2E_REDIS_URL} (run "docker compose up -d redis"): ${error.message}`,
      { cause: error },
    );
  } finally {
    redis.disconnect();
  }
}
