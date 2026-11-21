import { useEffect, useRef, useState } from "react";
import { REALTIME_EVENTS, createRealtimeSocket } from "../services/realtimeClient";

/**
 * Connection states exposed to the UI:
 * - "connecting": first connection attempt in progress
 * - "live": connected and receiving updates
 * - "reconnecting": connection lost, retrying automatically
 * - "offline": stopped (session expired or the server refused the session)
 */
export const REALTIME_STATUS = Object.freeze({
  CONNECTING: "connecting",
  LIVE: "live",
  RECONNECTING: "reconnecting",
  OFFLINE: "offline",
});

/**
 * Subscribes to server-pushed updates for the lifetime of the calling
 * component.
 *
 * - Exactly one socket and one listener per event name per mount. Handlers
 *   are read through a ref, so re-renders never add duplicate listeners.
 * - On unmount every listener is removed and the socket is closed.
 * - After a reconnect `onResync` is called, so anything missed while
 *   disconnected is refetched through the normal API.
 * - `session:expired` (or an auth rejection) calls `onSessionExpired` and stops
 *   reconnecting.
 */
export function useRealtimeUpdates({
  enabled = true,
  handlers = {},
  onResync,
  onSessionExpired,
  createSocket = createRealtimeSocket,
} = {}) {
  const [status, setStatus] = useState(
    enabled ? REALTIME_STATUS.CONNECTING : REALTIME_STATUS.OFFLINE,
  );
  const handlersRef = useRef(handlers);
  const resyncRef = useRef(onResync);
  const expiredRef = useRef(onSessionExpired);
  const createSocketRef = useRef(createSocket);

  useEffect(() => {
    handlersRef.current = handlers;
    resyncRef.current = onResync;
    expiredRef.current = onSessionExpired;
  });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const socket = createSocketRef.current();
    let hasConnectedBefore = false;
    let stopped = false;
    const bound = [];

    function on(eventName, listener) {
      socket.on(eventName, listener);
      bound.push([eventName, listener]);
    }

    function stop() {
      stopped = true;
      setStatus(REALTIME_STATUS.OFFLINE);
      socket.disconnect();
    }

    on("connect", () => {
      setStatus(REALTIME_STATUS.LIVE);

      if (hasConnectedBefore) {
        resyncRef.current?.();
      }

      hasConnectedBefore = true;
    });

    on("disconnect", () => {
      if (!stopped) {
        setStatus(REALTIME_STATUS.RECONNECTING);
      }
    });

    on("connect_error", (error) => {
      const message = error?.message || "";

      if (message === "Authentication required" || message === "Invalid or expired token") {
        stop();
        expiredRef.current?.();
        return;
      }

      if (!stopped) {
        setStatus(
          hasConnectedBefore ? REALTIME_STATUS.RECONNECTING : REALTIME_STATUS.CONNECTING,
        );
      }
    });

    on("session:expired", () => {
      stop();
      expiredRef.current?.();
    });

    for (const eventName of REALTIME_EVENTS) {
      on(eventName, (payload) => {
        handlersRef.current?.[eventName]?.(payload);
      });
    }

    return () => {
      stopped = true;

      for (const [eventName, listener] of bound) {
        socket.off(eventName, listener);
      }

      socket.disconnect();
    };
  }, [enabled]);

  return status;
}
