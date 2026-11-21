import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import {
  AUTH_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
} from "../src/services/authCookieService.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";

function getCookie(response, cookieName) {
  return response.headers["set-cookie"]?.find((cookie) =>
    cookie.startsWith(`${cookieName}=`),
  );
}

test("GET /api/auth/google redirects to Google OAuth with a server-generated state bound to an HTTP-only cookie", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:5000/api/auth/google/callback";

  const response = await request(app).get("/api/auth/google?state=attacker-chosen");

  assert.equal(response.status, 302);

  const redirectUrl = new URL(response.headers.location);

  assert.equal(redirectUrl.origin + redirectUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(redirectUrl.searchParams.get("client_id"), "test-client-id");
  assert.equal(redirectUrl.searchParams.get("redirect_uri"), "http://localhost:5000/api/auth/google/callback");
  assert.equal(redirectUrl.searchParams.get("response_type"), "code");

  const state = redirectUrl.searchParams.get("state");
  assert.ok(state && state.length >= 32, "state must be a long random value");
  assert.notEqual(state, "attacker-chosen", "client-supplied state must be ignored");

  const stateCookie = getCookie(response, OAUTH_STATE_COOKIE_NAME);
  assert.ok(stateCookie, "state cookie must be set");
  assert.ok(stateCookie.includes(`${OAUTH_STATE_COOKIE_NAME}=${state}`));
  assert.match(stateCookie, /HttpOnly/i);
  assert.match(stateCookie, /SameSite=Lax/i);
});

test("GET /api/auth/google/callback rejects a missing or mismatched OAuth state", async () => {
  process.env.FRONTEND_URL = "http://localhost:5173";

  const missingCookie = await request(app).get(
    "/api/auth/google/callback?code=test-code&state=abc",
  );
  assert.equal(
    new URL(missingCookie.headers.location).searchParams.get("error"),
    "invalid_oauth_state",
  );

  const mismatched = await request(app)
    .get("/api/auth/google/callback?code=test-code&state=abc")
    .set("Cookie", `${OAUTH_STATE_COOKIE_NAME}=different-state-value`);
  assert.equal(
    new URL(mismatched.headers.location).searchParams.get("error"),
    "invalid_oauth_state",
  );
  assert.equal(getCookie(mismatched, AUTH_COOKIE_NAME), undefined);
});

test("GET /api/auth/google/callback redirects with error when code is missing", async () => {
  process.env.FRONTEND_URL = "http://localhost:5173";

  const response = await request(app).get("/api/auth/google/callback");

  assert.equal(response.status, 302);

  const redirectUrl = new URL(response.headers.location);

  assert.equal(redirectUrl.origin + redirectUrl.pathname, "http://localhost:5173/auth/callback");
  assert.equal(redirectUrl.searchParams.get("error"), "missing_google_code");
});

test("GET /api/auth/google/callback redirects with error on upstream login failure", async () => {
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:5000/api/auth/google/callback";
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: "invalid_grant", error_description: "Bad code" }),
  });

  try {
    const response = await request(app)
      .get("/api/auth/google/callback?code=test-code&state=valid-state")
      .set("Cookie", `${OAUTH_STATE_COOKIE_NAME}=valid-state`);

    assert.equal(response.status, 302);

    const redirectUrl = new URL(response.headers.location);

    assert.equal(redirectUrl.origin + redirectUrl.pathname, "http://localhost:5173/auth/callback");
    // Upstream error details are logged server-side, not reflected to the browser.
    assert.equal(redirectUrl.searchParams.get("error"), "google_login_failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/auth/me returns authentication required without a token", async () => {
  const response = await request(app).get("/api/auth/me");

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Authentication required",
  });
});

test("GET /api/auth/me returns the current user with a valid bearer token", async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  const token = signAuthToken({
    id: "user-123",
    email: "ansh@example.com",
    name: "Ansh Sharma",
  });

  const response = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    user: {
      id: "user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
    },
  });
});

test("GET /api/auth/me returns the current user with a valid auth cookie", async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  const token = signAuthToken({
    id: "user-456",
    email: "cookie@example.com",
    name: "Cookie User",
  });

  const response = await request(app)
    .get("/api/auth/me")
    .set("Cookie", [`${AUTH_COOKIE_NAME}=${token}`]);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    user: {
      id: "user-456",
      email: "cookie@example.com",
      name: "Cookie User",
    },
  });
});

test("POST /api/auth/logout clears auth cookie", async () => {
  const response = await request(app).post("/api/auth/logout");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    message: "Logged out successfully",
  });

  const cookie = getCookie(response, AUTH_COOKIE_NAME);

  assert.ok(cookie);
  assert.ok(cookie.includes(`${AUTH_COOKIE_NAME}=`));
  assert.ok(cookie.includes("HttpOnly"));
});