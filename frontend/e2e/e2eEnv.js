// Settings for the servers Playwright starts. They use dedicated ports so an
// E2E run never collides with, or silently reuses, a development server.

export const E2E_API_PORT = Number(process.env.E2E_API_PORT || 5100);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT || 5180);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;

// Database used by the E2E backend. Override with E2E_MONGODB_URI; the name
// must end in "_e2e" (enforced in globalSetup).
export const E2E_MONGODB_URI =
  process.env.E2E_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/conflictfree_e2e?replicaSet=rs0";

// Redis for BullMQ (Phase M), normally the Docker container from
// `docker compose up -d redis`. E2E keys live under their own prefix, which
// globalSetup clears before every run; it must end in "e2e".
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL || "redis://127.0.0.1:6379";
export const E2E_BULLMQ_PREFIX = process.env.E2E_BULLMQ_PREFIX || "cfe2e";
// Fast reminder sweep so the reminder test does not wait a full minute.
export const E2E_REMINDER_SWEEP_INTERVAL_MS = "2000";
