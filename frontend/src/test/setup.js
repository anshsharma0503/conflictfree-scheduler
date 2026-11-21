import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { createFakeRealtimeSocket, resetFakeSockets } from "./fakeRealtimeSocket";

// Unit tests never open real network sockets. Components get an in-memory
// fake; tests drive it through `getLastFakeSocket()`.
vi.mock("../services/realtimeClient", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createRealtimeSocket: () => createFakeRealtimeSocket() };
});

afterEach(() => {
  resetFakeSockets();
});

// Node.js 25+ ships a built-in Web Storage global whose `localStorage` getter
// returns undefined unless `--localstorage-file` is passed. That getter shadows
// jsdom's Storage implementation inside Vitest. Re-expose jsdom's storage so
// browser code under test sees a real, isolated Storage object.
function restoreJsdomStorage(name) {
  const jsdomStorage = globalThis.jsdom?.window?.[name];
  let current;

  try {
    current = globalThis[name];
  } catch {
    current = undefined;
  }

  if (jsdomStorage && typeof current?.clear !== "function") {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: jsdomStorage,
    });
  }
}

restoreJsdomStorage("localStorage");
restoreJsdomStorage("sessionStorage");

afterEach(() => {
  cleanup();
});
