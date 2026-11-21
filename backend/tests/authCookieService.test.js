import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  getAuthCookie,
  setAuthCookie,
} from "../src/services/authCookieService.js";

function createMockResponse() {
  const calls = {
    cookie: [],
    clearCookie: [],
  };

  return {
    calls,
    cookie(name, value, options) {
      calls.cookie.push({ name, value, options });
    },
    clearCookie(name, options) {
      calls.clearCookie.push({ name, options });
    },
  };
}

test("setAuthCookie sets an HTTP-only auth cookie", () => {
  const res = createMockResponse();

  setAuthCookie(res, "test-token");

  assert.equal(res.calls.cookie.length, 1);
  assert.equal(res.calls.cookie[0].name, AUTH_COOKIE_NAME);
  assert.equal(res.calls.cookie[0].value, "test-token");
  assert.equal(res.calls.cookie[0].options.httpOnly, true);
  assert.equal(res.calls.cookie[0].options.sameSite, "lax");
  assert.equal(res.calls.cookie[0].options.maxAge, 7 * 24 * 60 * 60 * 1000);
});

test("clearAuthCookie clears auth cookie", () => {
  const res = createMockResponse();

  clearAuthCookie(res);

  assert.equal(res.calls.clearCookie.length, 1);
  assert.equal(res.calls.clearCookie[0].name, AUTH_COOKIE_NAME);
  assert.equal(res.calls.clearCookie[0].options.httpOnly, true);
  assert.equal(res.calls.clearCookie[0].options.sameSite, "lax");
});

test("getAuthCookie reads auth cookie", () => {
  const req = {
    cookies: {
      [AUTH_COOKIE_NAME]: "test-token",
    },
  };

  assert.equal(getAuthCookie(req), "test-token");
});

test("getAuthCookie returns null when missing", () => {
  assert.equal(getAuthCookie({ cookies: {} }), null);
  assert.equal(getAuthCookie({}), null);
});