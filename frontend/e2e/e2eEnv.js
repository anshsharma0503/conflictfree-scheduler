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
