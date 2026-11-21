import test from "node:test";
import assert from "node:assert/strict";
import {
  createGoogleOAuthUrl,
  exchangeGoogleCodeForTokens,
  fetchGoogleUserProfile,
  getGoogleAuthProfileFromCode,
} from "../src/services/googleOAuthService.js";

test("createGoogleOAuthUrl builds a Google OAuth authorization URL", () => {
  const authUrl = createGoogleOAuthUrl({
    clientId: "test-client-id",
    redirectUri: "http://localhost:5000/api/auth/google/callback",
    state: "test-state",
  });

  const url = new URL(authUrl);

  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5000/api/auth/google/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), null);
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("state"), "test-state");

  const scopes = url.searchParams.get("scope").split(" ");

  // Sign-in requests identity only (least privilege). Calendar access is a
  // separate optional consent and must never be bundled into login.
  assert.deepEqual(scopes.sort(), ["email", "openid", "profile"]);
  assert.ok(!scopes.some((scope) => scope.includes("calendar")));
});

test("createGoogleOAuthUrl requires GOOGLE_CLIENT_ID", () => {
  assert.throws(
    () =>
      createGoogleOAuthUrl({
        clientId: "",
        redirectUri: "http://localhost:5000/api/auth/google/callback",
      }),
    {
      message: "GOOGLE_CLIENT_ID is required",
    },
  );
});

test("createGoogleOAuthUrl requires GOOGLE_REDIRECT_URI", () => {
  assert.throws(
    () =>
      createGoogleOAuthUrl({
        clientId: "test-client-id",
        redirectUri: "",
      }),
    {
      message: "GOOGLE_REDIRECT_URI is required",
    },
  );
});

test("exchangeGoogleCodeForTokens sends a code to Google's token endpoint", async () => {
  const fetchCalls = [];

  async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });

    return {
      ok: true,
      async json() {
        return {
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          id_token: "google-id-token",
          expires_in: 3599,
          scope: "openid email profile",
          token_type: "Bearer",
        };
      },
    };
  }

  const tokens = await exchangeGoogleCodeForTokens("test-code", {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:5000/api/auth/google/callback",
    fetchClient: fakeFetch,
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.deepEqual(fetchCalls[0].options.headers, {
    "Content-Type": "application/x-www-form-urlencoded",
  });

  const body = fetchCalls[0].options.body;

  assert.equal(body.get("code"), "test-code");
  assert.equal(body.get("client_id"), "test-client-id");
  assert.equal(body.get("client_secret"), "test-client-secret");
  assert.equal(body.get("redirect_uri"), "http://localhost:5000/api/auth/google/callback");
  assert.equal(body.get("grant_type"), "authorization_code");

  assert.deepEqual(tokens, {
    accessToken: "google-access-token",
    refreshToken: "google-refresh-token",
    idToken: "google-id-token",
    expiresIn: 3599,
    scope: "openid email profile",
    tokenType: "Bearer",
  });
});

test("exchangeGoogleCodeForTokens requires a code", async () => {
  await assert.rejects(
    () =>
      exchangeGoogleCodeForTokens("", {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:5000/api/auth/google/callback",
        fetchClient: async () => {},
      }),
    {
      message: "Google authorization code is required",
    },
  );
});

test("exchangeGoogleCodeForTokens handles Google error responses", async () => {
  async function fakeFetch() {
    return {
      ok: false,
      async json() {
        return {
          error: "invalid_grant",
          error_description: "Bad Request",
        };
      },
    };
  }

  await assert.rejects(
    () =>
      exchangeGoogleCodeForTokens("bad-code", {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:5000/api/auth/google/callback",
        fetchClient: fakeFetch,
      }),
    {
      message: "Bad Request",
    },
  );
});

test("fetchGoogleUserProfile fetches and normalizes Google profile data", async () => {
  const fetchCalls = [];

  async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });

    return {
      ok: true,
      async json() {
        return {
          sub: "google-user-123",
          email: "ansh@example.com",
          name: "Ansh Sharma",
          picture: "https://example.com/avatar.png",
          email_verified: true,
        };
      },
    };
  }

  const profile = await fetchGoogleUserProfile("google-access-token", {
    fetchClient: fakeFetch,
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://openidconnect.googleapis.com/v1/userinfo");
  assert.deepEqual(fetchCalls[0].options, {
    method: "GET",
    headers: {
      Authorization: "Bearer google-access-token",
    },
  });

  assert.deepEqual(profile, {
    googleId: "google-user-123",
    email: "ansh@example.com",
    name: "Ansh Sharma",
    avatarUrl: "https://example.com/avatar.png",
    emailVerified: true,
  });
});

test("fetchGoogleUserProfile requires an access token", async () => {
  await assert.rejects(() => fetchGoogleUserProfile(""), {
    message: "Google access token is required",
  });
});

test("fetchGoogleUserProfile requires Google sub", async () => {
  async function fakeFetch() {
    return {
      ok: true,
      async json() {
        return {
          email: "ansh@example.com",
        };
      },
    };
  }

  await assert.rejects(
    () =>
      fetchGoogleUserProfile("google-access-token", {
        fetchClient: fakeFetch,
      }),
    {
      message: "Google profile is missing sub",
    },
  );
});

test("fetchGoogleUserProfile requires Google email", async () => {
  async function fakeFetch() {
    return {
      ok: true,
      async json() {
        return {
          sub: "google-user-123",
        };
      },
    };
  }

  await assert.rejects(
    () =>
      fetchGoogleUserProfile("google-access-token", {
        fetchClient: fakeFetch,
      }),
    {
      message: "Google profile is missing email",
    },
  );
});

test("getGoogleAuthProfileFromCode exchanges code and fetches profile", async () => {
  const fetchCalls = [];

  async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });

    if (url === "https://oauth2.googleapis.com/token") {
      return {
        ok: true,
        async json() {
          return {
            access_token: "google-access-token",
            refresh_token: "google-refresh-token",
            id_token: "google-id-token",
            expires_in: 3599,
            scope: "openid email profile",
            token_type: "Bearer",
          };
        },
      };
    }

    return {
      ok: true,
      async json() {
        return {
          sub: "google-user-123",
          email: "ansh@example.com",
          name: "Ansh Sharma",
          picture: "https://example.com/avatar.png",
          email_verified: true,
        };
      },
    };
  }

  const result = await getGoogleAuthProfileFromCode("test-code", {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:5000/api/auth/google/callback",
    fetchClient: fakeFetch,
  });

  assert.equal(fetchCalls.length, 2);

  assert.deepEqual(result.profile, {
    googleId: "google-user-123",
    email: "ansh@example.com",
    name: "Ansh Sharma",
    avatarUrl: "https://example.com/avatar.png",
    emailVerified: true,
  });

  assert.deepEqual(result.tokens, {
    accessToken: "google-access-token",
    refreshToken: "google-refresh-token",
    idToken: "google-id-token",
    expiresIn: 3599,
    scope: "openid email profile",
    tokenType: "Bearer",
  });
});