import { getAuthCookie } from "../services/authCookieService.js";
import { verifyAuthToken } from "../services/tokenService.js";

function getBearerToken(req) { // This function extracts a JWT from the HTTP Authorization header.
  const authorizationHeader = req.get("Authorization");

  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function requireAuth(req, res, next) {
  const token = getAuthCookie(req) || getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  try {
    const payload = verifyAuthToken(token);

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}