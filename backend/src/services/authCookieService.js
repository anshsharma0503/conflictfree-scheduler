const AUTH_COOKIE_NAME = "conflictfree_token";
const OAUTH_STATE_COOKIE_NAME = "conflictfree_oauth_state";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function isSecureCookie() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

function getSameSite() {
  const configured = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
  return ["lax", "strict", "none"].includes(configured) ? configured : "lax";
}

function baseCookieOptions() {
  const options = {
    httpOnly: true,
    sameSite: getSameSite(),
    secure: isSecureCookie(),
    path: "/",
  };

  if (process.env.COOKIE_DOMAIN) {
    options.domain = process.env.COOKIE_DOMAIN;
  }

  return options;
}

export function getAuthCookieMaxAgeMs() {
  const configured = Number(process.env.AUTH_COOKIE_MAX_AGE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : COOKIE_MAX_AGE_MS;
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: getAuthCookieMaxAgeMs(),
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, baseCookieOptions());
}

export function getAuthCookie(req) {
  return req.cookies?.[AUTH_COOKIE_NAME] || null;
}

// The OAuth state cookie must survive the top-level cross-site redirect back
// from Google, so it always uses SameSite=Lax regardless of COOKIE_SAME_SITE.
function oauthStateCookieOptions() {
  return {
    ...baseCookieOptions(),
    sameSite: "lax",
    path: "/api/auth/google",
  };
}

export function setOAuthStateCookie(res, state) {
  res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
    ...oauthStateCookieOptions(),
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  });
}

export function getOAuthStateCookie(req) {
  return req.cookies?.[OAUTH_STATE_COOKIE_NAME] || null;
}

export function clearOAuthStateCookie(res) {
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions());
}

export { AUTH_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME };
