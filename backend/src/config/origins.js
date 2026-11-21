const DEFAULT_FRONTEND_URL = "http://localhost:5173";

function normalizeOrigin(value) {
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

/**
 * Browser origins allowed to call the API with credentials and to open
 * authenticated Socket.io connections.
 *
 * - FRONTEND_URL is always allowed.
 * - CORS_ORIGINS adds a comma-separated list (e.g. a staging frontend).
 * - Outside production, the 127.0.0.1 / localhost twin of each allowed
 *   loopback origin is added because Vite and Playwright use either host.
 */
export function getAllowedOrigins(env = process.env) {
  const origins = new Set();
  const candidates = [
    env.FRONTEND_URL || DEFAULT_FRONTEND_URL,
    ...String(env.CORS_ORIGINS || "").split(","),
  ];

  for (const candidate of candidates) {
    const origin = candidate ? normalizeOrigin(candidate) : null;

    if (origin) {
      origins.add(origin);
    }
  }

  if (env.NODE_ENV !== "production") {
    for (const origin of Array.from(origins)) {
      const url = new URL(origin);

      if (url.hostname === "localhost") {
        url.hostname = "127.0.0.1";
        origins.add(url.origin);
      } else if (url.hostname === "127.0.0.1") {
        url.hostname = "localhost";
        origins.add(url.origin);
      }
    }
  }

  return Array.from(origins);
}
