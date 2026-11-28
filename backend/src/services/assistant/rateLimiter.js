/**
 * Small in-memory sliding-window limiter, keyed by user id. Each assistant
 * request is a paid model call, so one user cannot burn the API quota.
 *
 * In-memory is enough for a single API process. With several instances
 * the limit applies per instance; a Redis-backed limiter belongs with the
 * wider rate-limiting work in Phase P.
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();

  function prune(key, current) {
    const recent = (hits.get(key) || []).filter((time) => current - time < windowMs);

    if (recent.length === 0) {
      hits.delete(key);
    } else {
      hits.set(key, recent);
    }

    return recent;
  }

  return {
    /** Returns { allowed, retryAfterSeconds }. Records the hit when allowed. */
    take(key) {
      const current = now();
      const recent = prune(key, current);

      if (recent.length >= limit) {
        const retryAfterMs = windowMs - (current - recent[0]);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }

      recent.push(current);
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },

    reset() {
      hits.clear();
    },
  };
}
