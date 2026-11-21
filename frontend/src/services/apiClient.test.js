import { afterEach, expect, test, vi } from "vitest";
import apiRequest from "./apiClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubResponse(response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("sends credentials and returns parsed JSON", async () => {
  const fetchMock = stubResponse({ ok: true, status: 200, json: async () => ({ success: true }) });

  await expect(apiRequest("/api/health")).resolves.toEqual({ success: true });
  expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
});

test("surfaces the server's JSON message and HTTP status on errors", async () => {
  stubResponse({
    ok: false,
    status: 409,
    json: async () => ({ success: false, message: "Resource is already booked" }),
  });

  await expect(apiRequest("/api/events")).rejects.toMatchObject({
    message: "Resource is already booked",
    status: 409,
  });
});

test("a non-JSON error page (e.g. a proxy 502) gives a readable error, not a JSON parse crash", async () => {
  stubResponse({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
  });

  await expect(apiRequest("/api/events")).rejects.toMatchObject({
    message: "Request failed (HTTP 502)",
    status: 502,
  });
});

test("a network failure gives a clear connection message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );

  await expect(apiRequest("/api/events")).rejects.toMatchObject({ status: 0 });
});

test("204 No Content resolves to an empty object", async () => {
  stubResponse({
    ok: true,
    status: 204,
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  });

  await expect(apiRequest("/api/x", { method: "DELETE" })).resolves.toEqual({});
});
