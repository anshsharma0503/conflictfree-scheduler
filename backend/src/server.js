import "dotenv/config";
import http from "node:http";
import app from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { closeSocketServer, createSocketServer } from "./realtime/socketServer.js";
import { logger } from "./services/logger.js";

const port = process.env.PORT || 5000;
const SHUTDOWN_TIMEOUT_MS = 10000;

async function startServer() {
  try {
    await connectDatabase();

    const httpServer = http.createServer(app);
    const io = createSocketServer(httpServer);

    httpServer.listen(port, () => {
      logger.info("server_started", { port: Number(port) });
      console.log(`ConflictFree API running on port ${port}`);
    });

    let shuttingDown = false;

    async function shutdown(signal) {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      logger.info("server_shutdown_started", { signal });

      const forceExit = setTimeout(() => {
        logger.error("server_shutdown_timeout", {});
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref();

      try {
        await closeSocketServer(io);
        await new Promise((resolve) => httpServer.close(() => resolve()));
        await disconnectDatabase();
        logger.info("server_shutdown_complete", {});
        process.exit(0);
      } catch (error) {
        logger.error("server_shutdown_failed", { errorMessage: error.message });
        process.exit(1);
      }
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Failed to start ConflictFree API");
    console.error(error.message);
    process.exit(1);
  }
}

startServer();
