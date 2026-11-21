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

process.env.NODE_ENV = "test";
