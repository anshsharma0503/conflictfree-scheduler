import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/middleware/requireAuth.js";
import { AUTH_COOKIE_NAME } from "../src/services/authCookieService.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";

function createMockRequest(headers = {}, cookies = {}) {
  return {
    user: null,
    cookies,
    get(headerName) {
      return headers[headerName];
    },
  };
}

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("requireAuth blocks requests without token", () => {
  const req = createMockRequest();
  const res = createMockResponse();
  let nextWasCalled = false;

  requireAuth(req, res, () => {
    nextWasCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    success: false,
    message: "Authentication required",
  });
  assert.equal(nextWasCalled, false);
});

test("requireAuth blocks requests with an invalid token", () => {
  const req = createMockRequest({
    Authorization: "Bearer invalid-token",
  });
  const res = createMockResponse();
  let nextWasCalled = false;

  process.env.JWT_SECRET = TEST_JWT_SECRET;

  requireAuth(req, res, () => {
    nextWasCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    success: false,
    message: "Invalid or expired token",
  });
  assert.equal(nextWasCalled, false);
});

test("requireAuth allows requests with a valid bearer token", () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  const token = signAuthToken({
    id: "user-123",
    email: "ansh@example.com",
    name: "Ansh Sharma",
  });

  const req = createMockRequest({
    Authorization: `Bearer ${token}`,
  });
  const res = createMockResponse();
  let nextWasCalled = false;

  requireAuth(req, res, () => {
    nextWasCalled = true;
  });

  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
  assert.equal(nextWasCalled, true);
  assert.deepEqual(req.user, {
    id: "user-123",
    email: "ansh@example.com",
    name: "Ansh Sharma",
  });
});

test("requireAuth allows requests with a valid auth cookie", () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  const token = signAuthToken({
    id: "user-456",
    email: "cookie@example.com",
    name: "Cookie User",
  });

  const req = createMockRequest(
    {},
    {
      [AUTH_COOKIE_NAME]: token,
    },
  );
  const res = createMockResponse();
  let nextWasCalled = false;

  requireAuth(req, res, () => {
    nextWasCalled = true;
  });

  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
  assert.equal(nextWasCalled, true);
  assert.deepEqual(req.user, {
    id: "user-456",
    email: "cookie@example.com",
    name: "Cookie User",
  });
});