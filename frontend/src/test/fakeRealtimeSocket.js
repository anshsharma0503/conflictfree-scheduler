// In-memory stand-in for a socket.io-client Socket used by unit tests.
// It records listeners so tests can assert there are no duplicates or leaks,
// and lets tests push server events with `serverEmit`.
export class FakeRealtimeSocket {
  constructor() {
    this.listeners = new Map();
    this.connected = false;
    this.disconnectCalls = 0;
  }

  on(eventName, listener) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(listener);
    return this;
  }

  off(eventName, listener) {
    this.listeners.get(eventName)?.delete(listener);
    return this;
  }

  disconnect() {
    this.connected = false;
    this.disconnectCalls += 1;
    return this;
  }

  listenerCount(eventName) {
    return this.listeners.get(eventName)?.size || 0;
  }

  totalListenerCount() {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  serverEmit(eventName, payload) {
    for (const listener of Array.from(this.listeners.get(eventName) || [])) {
      listener(payload);
    }
  }

  simulateConnect() {
    this.connected = true;
    this.serverEmit("connect");
  }

  simulateDisconnect(reason = "transport close") {
    this.connected = false;
    this.serverEmit("disconnect", reason);
  }
}

export const fakeSockets = [];

export function createFakeRealtimeSocket() {
  const socket = new FakeRealtimeSocket();
  fakeSockets.push(socket);
  return socket;
}

export function getLastFakeSocket() {
  return fakeSockets[fakeSockets.length - 1];
}

export function resetFakeSockets() {
  fakeSockets.length = 0;
}
