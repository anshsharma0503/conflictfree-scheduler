import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/config/database.js";

function createFakeMongooseClient(initialReadyState = 0) {
  const calls = {
    connect: [],
    disconnect: 0,
  };

  const fakeMongooseClient = {
    connection: {
      readyState: initialReadyState,
    },
    async connect(uri, options) {
      calls.connect.push({ uri, options });
      fakeMongooseClient.connection.readyState = 1;
    },
    async disconnect() {
      calls.disconnect += 1;
      fakeMongooseClient.connection.readyState = 0;
    },
  };

  return {
    fakeMongooseClient,
    calls,
  };
}

test("connectDatabase requires a MongoDB URI", async () => {
  const { fakeMongooseClient } = createFakeMongooseClient();
  const { connectDatabase } = createDatabaseClient(fakeMongooseClient);

  await assert.rejects(() => connectDatabase(""), {
    message: "MONGODB_URI is required",
  });
});

test("connectDatabase connects with the provided URI", async () => {
  const { fakeMongooseClient, calls } = createFakeMongooseClient();
  const { connectDatabase } = createDatabaseClient(fakeMongooseClient);

  const connection = await connectDatabase("mongodb://127.0.0.1:27017/conflictfree");

  assert.equal(connection.readyState, 1);
  assert.equal(calls.connect.length, 1);
  assert.equal(calls.connect[0].uri, "mongodb://127.0.0.1:27017/conflictfree");
  assert.deepEqual(calls.connect[0].options, {
    serverSelectionTimeoutMS: 5000,
  });
});

test("connectDatabase does not reconnect when already connected", async () => {
  const { fakeMongooseClient, calls } = createFakeMongooseClient(1);
  const { connectDatabase } = createDatabaseClient(fakeMongooseClient);

  const connection = await connectDatabase("mongodb://127.0.0.1:27017/conflictfree");

  assert.equal(connection.readyState, 1);
  assert.equal(calls.connect.length, 0);
});

test("disconnectDatabase disconnects when connected", async () => {
  const { fakeMongooseClient, calls } = createFakeMongooseClient(1);
  const { disconnectDatabase } = createDatabaseClient(fakeMongooseClient);

  await disconnectDatabase();

  assert.equal(fakeMongooseClient.connection.readyState, 0);
  assert.equal(calls.disconnect, 1);
});

test("disconnectDatabase does nothing when already disconnected", async () => {
  const { fakeMongooseClient, calls } = createFakeMongooseClient(0);
  const { disconnectDatabase } = createDatabaseClient(fakeMongooseClient);

  await disconnectDatabase();

  assert.equal(fakeMongooseClient.connection.readyState, 0);
  assert.equal(calls.disconnect, 0);
});