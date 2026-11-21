const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// Sign-in only needs identity. Calendar access is a separate, optional,
// user-initiated consent (see docs/DECISIONS.md) and is never requested here.
export const GOOGLE_LOGIN_SCOPES = Object.freeze(["openid", "email", "profile"]);

export function createGoogleOAuthUrl({
  clientId = process.env.GOOGLE_CLIENT_ID,
  redirectUri = process.env.GOOGLE_REDIRECT_URI,
  state,
} = {}) {
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is required");
  }

  if (!redirectUri) {
    throw new Error("GOOGLE_REDIRECT_URI is required");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_LOGIN_SCOPES.join(" "),
    include_granted_scopes: "true",
    prompt: "select_account",
  });

  if (state) {
    params.set("state", state);
  }

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCodeForTokens(
  code,
  {
    clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    redirectUri = process.env.GOOGLE_REDIRECT_URI,
    fetchClient = fetch,
  } = {},
) {
  if (!code) {
    throw new Error("Google authorization code is required");
  }

  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is required");
  }

  if (!clientSecret) {
    throw new Error("GOOGLE_CLIENT_SECRET is required");
  }

  if (!redirectUri) {
    throw new Error("GOOGLE_REDIRECT_URI is required");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetchClient(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google token exchange failed");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    idToken: data.id_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export async function fetchGoogleUserProfile(accessToken, { fetchClient = fetch } = {}) {
  if (!accessToken) {
    throw new Error("Google access token is required");
  }

  const response = await fetchClient(GOOGLE_USERINFO_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google profile fetch failed");
  }

  if (!data.sub) {
    throw new Error("Google profile is missing sub");
  }

  if (!data.email) {
    throw new Error("Google profile is missing email");
  }

  return {
    googleId: data.sub,
    email: data.email,
    name: data.name || data.email,
    avatarUrl: data.picture || null,
    emailVerified: Boolean(data.email_verified),
  };
}

export async function getGoogleAuthProfileFromCode(
  code,
  {
    clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    redirectUri = process.env.GOOGLE_REDIRECT_URI,
    fetchClient = fetch,
  } = {},
) {
  const tokens = await exchangeGoogleCodeForTokens(code, {
    clientId,
    clientSecret,
    redirectUri,
    fetchClient,
  });

  const profile = await fetchGoogleUserProfile(tokens.accessToken, {
    fetchClient,
  });

  return {
    tokens,
    profile,
  };
}