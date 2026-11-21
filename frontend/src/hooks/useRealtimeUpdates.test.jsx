import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { REALTIME_EVENTS } from "../services/realtimeClient";
import { FakeRealtimeSocket } from "../test/fakeRealtimeSocket";
import { REALTIME_STATUS, useRealtimeUpdates } from "./useRealtimeUpdates";

function setup(props = {}) {
  const sockets = [];
  const createSocket = vi.fn(() => {
    const socket = new FakeRealtimeSocket();
    sockets.push(socket);
    return socket;
  });

  const hook = renderHook((hookProps) => useRealtimeUpdates({ createSocket, ...hookProps }), {
    initialProps: props,
  });

  return { ...hook, sockets, createSocket };
}

test("opens one socket with exactly one listener per event, and re-renders never add listeners", () => {
  const { sockets, createSocket, rerender } = setup({ handlers: { "event:created": vi.fn() } });

  expect(createSocket).toHaveBeenCalledTimes(1);
  const socket = sockets[0];
  for (const eventName of REALTIME_EVENTS) {
    expect(socket.listenerCount(eventName)).toBe(1);
  }
  const total = socket.totalListenerCount();

  rerender({ handlers: { "event:created": vi.fn() } });
  rerender({ handlers: { "event:created": vi.fn(), "event:deleted": vi.fn() } });

  expect(createSocket).toHaveBeenCalledTimes(1);
  expect(socket.totalListenerCount()).toBe(total);
});

test("dispatches pushed events to the latest handler", () => {
  const first = vi.fn();
  const latest = vi.fn();
  const { sockets, rerender } = setup({ handlers: { "invitation:created": first } });

  rerender({ handlers: { "invitation:created": latest } });
  act(() => sockets[0].serverEmit("invitation:created", { meeting: { id: "m1" } }));

  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith({ meeting: { id: "m1" } });
});

test("removes every listener and disconnects on unmount (no leaks)", () => {
  const { sockets, unmount } = setup();
  const socket = sockets[0];

  unmount();

  expect(socket.totalListenerCount()).toBe(0);
  expect(socket.disconnectCalls).toBe(1);
});

test("reports live/reconnecting status and resyncs only after a reconnect", () => {
  const onResync = vi.fn();
  const { result, sockets } = setup({ onResync });
  const socket = sockets[0];

  expect(result.current).toBe(REALTIME_STATUS.CONNECTING);

  act(() => socket.simulateConnect());
  expect(result.current).toBe(REALTIME_STATUS.LIVE);
  expect(onResync).not.toHaveBeenCalled();

  act(() => socket.simulateDisconnect());
  expect(result.current).toBe(REALTIME_STATUS.RECONNECTING);

  act(() => socket.simulateConnect());
  expect(result.current).toBe(REALTIME_STATUS.LIVE);
  expect(onResync).toHaveBeenCalledTimes(1);
});

test("session expiry or an auth rejection stops the socket and notifies once", () => {
  const onSessionExpired = vi.fn();
  const { result, sockets } = setup({ onSessionExpired });
  const socket = sockets[0];

  act(() => socket.simulateConnect());
  act(() => socket.serverEmit("session:expired", { reason: "token_expired" }));

  expect(onSessionExpired).toHaveBeenCalledTimes(1);
  expect(socket.disconnectCalls).toBe(1);
  expect(result.current).toBe(REALTIME_STATUS.OFFLINE);

  const second = setup({ onSessionExpired: vi.fn() });
  act(() => second.sockets[0].serverEmit("connect_error", new Error("Authentication required")));
  expect(second.result.current).toBe(REALTIME_STATUS.OFFLINE);
});

test("does not connect when disabled (e.g. signed out)", () => {
  const { createSocket, result } = setup({ enabled: false });

  expect(createSocket).not.toHaveBeenCalled();
  expect(result.current).toBe(REALTIME_STATUS.OFFLINE);
});
