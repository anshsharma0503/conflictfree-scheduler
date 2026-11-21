import { Server } from "socket.io";
import { AUTH_COOKIE_NAME } from "../services/authCookieService.js";
import { logger } from "../services/logger.js";
import { verifyAuthToken } from "../services/tokenService.js";
import { getAllowedOrigins } from "../config/origins.js";
import { AUTHENTICATED_ROOM, setRealtimeServer, userRoom } from "./realtimeService.js";

const MAX_TIMER_MS = 2 ** 31 - 1;

export function parseCookieHeader(header = "") {
  const cookies = {};

  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();

    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

/**
 * Browsers always send Origin on WebSocket/XHR requests. A cookie-authenticated
 * socket from a foreign origin would be cross-site WebSocket hijacking, so only
 * allow-listed origins are accepted. Requests without Origin come from
 * non-browser clients, which cannot ride a victim's cookies.
 */
export function isOriginAllowed(origin, allowedOrigins = getAllowedOrigins()) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

/**
 * Socket.io handshake authentication. The JWT is read ONLY from the existing
 * HTTP-only auth cookie; tokens passed in the URL query or the `auth` payload
 * are ignored so they never appear in logs, history, or proxies.
 */
export function authenticateSocket(socket, next) {
  const cookies = parseCookieHeader(socket.handshake.headers?.cookie);
  const token = cookies[AUTH_COOKIE_NAME];

  if (!token) {
    return next(new Error("Authentication required"));
  }

  try {
    const payload = verifyAuthToken(token);

    socket.data.user = {
      id: String(payload.sub),
      email: payload.email,
      name: payload.name,
    };
    socket.data.tokenExpiresAt = payload.exp ? payload.exp * 1000 : null;

    return next();
  } catch {
    return next(new Error("Invalid or expired token"));
  }
}

function scheduleExpiryDisconnect(socket) {
  const expiresAt = socket.data.tokenExpiresAt;

  if (!expiresAt) {
    return;
  }

  const delay = Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMER_MS);
  const timer = setTimeout(() => {
    socket.emit("session:expired", { reason: "token_expired" });
    socket.disconnect(true);
  }, delay);

  timer.unref?.();
  socket.once("disconnect", () => clearTimeout(timer));
}

export function createSocketServer(httpServer, { allowedOrigins = getAllowedOrigins() } = {}) {
  const io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const allowed = isOriginAllowed(req.headers.origin, allowedOrigins);

      if (!allowed) {
        logger.warn("socket_origin_rejected", { origin: req.headers.origin });
      }

      callback(null, allowed);
    },
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const { id: userId } = socket.data.user;

    socket.join(userRoom(userId));
    socket.join(AUTHENTICATED_ROOM);
    scheduleExpiryDisconnect(socket);

    socket.emit("session:ready", { userId });

    // Clients cannot join arbitrary rooms or send commands: the server only
    // pushes. Any client-originated event is ignored.
  });

  setRealtimeServer(io);

  return io;
}

export async function closeSocketServer(io) {
  if (!io) {
    return;
  }

  setRealtimeServer(null);

  await new Promise((resolve) => {
    io.close(() => resolve());
  });
}
