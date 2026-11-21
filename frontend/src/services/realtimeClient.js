import { io } from "socket.io-client";

/**
 * Real-time event names pushed by the backend (see docs/ARCHITECTURE.md).
 * The client never sends commands; it only listens.
 */
export const REALTIME_EVENTS = Object.freeze([
  "event:created",
  "event:updated",
  "event:deleted",
  "meeting:confirmed",
  "meeting:updated",
  "meeting:cancelled",
  "invitation:created",
  "invitation:accepted",
  "invitation:declined",
  "resource:created",
  "resource:updated",
  "resource:deactivated",
  "resource:booking-changed",
  "notification:created",
]);

/**
 * Opens an authenticated Socket.io connection to the same origin as the app.
 * In development Vite proxies /socket.io to the API. Authentication relies
 * solely on the browser sending the HTTP-only auth cookie: no token is ever
 * read by JavaScript or put in the URL.
 */
export function createRealtimeSocket() {
  return io({
    path: "/socket.io",
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
}
