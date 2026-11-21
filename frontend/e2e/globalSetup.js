import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_MONGODB_URI } from "./e2eEnv.js";

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
}
