import crypto from "node:crypto";
import User from "../models/User.js";
import { logger } from "../services/logger.js";
import {
  clearAuthCookie,
  clearOAuthStateCookie,
  getOAuthStateCookie,
  setAuthCookie,
  setOAuthStateCookie,
} from "../services/authCookieService.js";
import {
  findOrCreateUserFromGoogleProfile,
  loginLocalUser,
  registerLocalUser,
} from "../services/authService.js";
import {
  createGoogleOAuthUrl,
  getGoogleAuthProfileFromCode,
} from "../services/googleOAuthService.js";
import { isValidTimezone } from "../services/timezoneService.js";
import { signAuthToken } from "../services/tokenService.js";

const DEFAULT_FRONTEND_URL = "http://localhost:5173";

function serializeUser(user) {
  return {
    id: user.id || user._id?.toString(),
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
  };
}

function sendAuthResponse(res, user, statusCode = 200) {
  const token = signAuthToken(user);

  setAuthCookie(res, token);

  return res.status(statusCode).json({
    success: true,
    user: serializeUser(user),
  });
}

function statesMatch(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function startGoogleLogin(req, res) {
  // Server-generated, single-use state bound to this browser via an
  // HTTP-only cookie. Prevents login CSRF / authorization-code injection.
  const state = crypto.randomBytes(32).toString("base64url");
  const authUrl = createGoogleOAuthUrl({ state });

  setOAuthStateCookie(res, state);
  res.redirect(authUrl);
}

export async function handleGoogleCallback(req, res) {
  const code = req.query.code?.toString();
  const frontendUrl = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;

  const expectedState = getOAuthStateCookie(req);
  clearOAuthStateCookie(res);

  if (req.query.error) {
    return res.redirect(`${frontendUrl}/auth/callback?error=google_access_denied`);
  }

  if (!code) {
    return res.redirect(`${frontendUrl}/auth/callback?error=missing_google_code`);
  }

  if (!statesMatch(expectedState, req.query.state?.toString())) {
    return res.redirect(`${frontendUrl}/auth/callback?error=invalid_oauth_state`);
  }

  try {
    const { profile } = await getGoogleAuthProfileFromCode(code);
    const user = await findOrCreateUserFromGoogleProfile(profile);
    const token = signAuthToken(user);
    const serializedUser = serializeUser(user);

    setAuthCookie(res, token);
 
    const callbackUrl = new URL("/auth/callback", frontendUrl);

    callbackUrl.searchParams.set("user", JSON.stringify(serializedUser));

    return res.redirect(callbackUrl.toString());
  } catch (error) {
    logger.warn("google_login_failed", { errorMessage: error.message });

    const callbackUrl = new URL("/auth/callback", frontendUrl);

    callbackUrl.searchParams.set(
      "error",
      error.message === "Google account email is not verified"
        ? "google_email_not_verified"
        : "google_login_failed",
    );

    return res.redirect(callbackUrl.toString());
  }
}

export async function register(req, res) {
  try {
    const user = await registerLocalUser(req.body);

    return sendAuthResponse(res, user, 201);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * PATCH /api/auth/me — currently only the timezone can be changed. It
 * drives how every time in the app is read and shown: reminders, the week
 * calendar, slot preferences and the assistant's "tomorrow afternoon".
 */
export async function updateCurrentUser(req, res) {
  const timezone = typeof req.body?.timezone === "string" ? req.body.timezone.trim() : "";

  if (!isValidTimezone(timezone)) {
    return res.status(400).json({
      success: false,
      message: "timezone must be a valid IANA time zone, e.g. Asia/Kolkata",
    });
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { $set: { timezone } },
    { returnDocument: "after", runValidators: true },
  );

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  return res.status(200).json({ success: true, user: serializeUser(user) });
}

export async function login(req, res) {
  try {
    const user = await loginLocalUser(req.body);

    return sendAuthResponse(res, user);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message,
    });
  }
}

export async function getCurrentUser(req, res) {
  try {
    let user = null;
    if (User && typeof User.findById === "function") {
      try {
        user = await User.findById(req.user.id);
      } catch {
      }
    }

    if (user) {
      return res.status(200).json({
        success: true,
        user: serializeUser(user),
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        ...(req.user.timezone ? { timezone: req.user.timezone } : {}),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

export function logout(req, res) {
  clearAuthCookie(res);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
}