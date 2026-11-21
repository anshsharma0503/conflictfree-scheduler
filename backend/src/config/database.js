import mongoose from "mongoose";

const CONNECTED_STATE = 1;
const DISCONNECTED_STATE = 0;

export function createDatabaseClient(mongooseClient = mongoose) {
  async function connectDatabase(mongoUri = process.env.MONGODB_URI) {
    if (!mongoUri) {
      throw new Error("MONGODB_URI is required");
    }

    if (mongooseClient.connection.readyState === CONNECTED_STATE) {
      return mongooseClient.connection;
    }

    await mongooseClient.connect(mongoUri, { 
      serverSelectionTimeoutMS: 5000,
    });

    return mongooseClient.connection;
  }

  async function disconnectDatabase() {
    if (mongooseClient.connection.readyState === DISCONNECTED_STATE) {
      return;
    }

    await mongooseClient.disconnect();
  }

  return {
    connectDatabase,
    disconnectDatabase,
  };
}

const databaseClient = createDatabaseClient();

export const connectDatabase = databaseClient.connectDatabase;
export const disconnectDatabase = databaseClient.disconnectDatabase;