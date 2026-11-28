// Preloaded for every backend test process via `node --test --import`.
//
// Integration tests call `Event.deleteMany({})` and `Resource.deleteMany({})`,
// so they must never run against the development database. This preload runs
// before any test file imports `dotenv/config`; because dotenv never overrides
// variables that are already set, the test database chosen here always wins.
import dotenv from "dotenv";

const TEST_DATABASE_SUFFIX = "_test";

function withDatabaseName(uri, databaseName) {
  const url = new URL(uri);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function getDatabaseName(uri) {
  return new URL(uri).pathname.replace(/^\//, "");
}

const loaded = dotenv.config({ quiet: true }).parsed || {};
const explicitTestUri = process.env.MONGODB_URI_TEST || loaded.MONGODB_URI_TEST;
const developmentUri = process.env.MONGODB_URI || loaded.MONGODB_URI;

let testUri = explicitTestUri;

if (!testUri && developmentUri) {
  const developmentName = getDatabaseName(developmentUri) || "conflictfree";
  testUri = withDatabaseName(
    developmentUri,
    developmentName.endsWith(TEST_DATABASE_SUFFIX)
      ? developmentName
      : `${developmentName}${TEST_DATABASE_SUFFIX}`,
  );
}

if (testUri) {
  const databaseName = getDatabaseName(testUri);

  if (!databaseName.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}". ` +
        `Test databases must end with "${TEST_DATABASE_SUFFIX}".`,
    );
  }

  process.env.MONGODB_URI = testUri;
}

// Redis for the queue tests. Their keys always live under the "cftest"
// prefix, and the tests only ever obliterate queues under that prefix, so
// development jobs in the same Redis are never touched.
process.env.REDIS_URL =
  process.env.REDIS_URL_TEST ||
  loaded.REDIS_URL_TEST ||
  process.env.REDIS_URL ||
  loaded.REDIS_URL ||
  "redis://127.0.0.1:6379";
process.env.BULLMQ_PREFIX = "cftest";

// Automated tests never call the real (paid) Gemini API. Assistant tests
// inject a fake client; `npm run assistant:smoke` exercises the real one.
process.env.GEMINI_API_KEY = "";

process.env.NODE_ENV = "test";
