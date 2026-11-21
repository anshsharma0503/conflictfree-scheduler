import jwt from "jsonwebtoken";

const DEFAULT_TOKEN_EXPIRES_IN = "7d";
const JWT_ALGORITHM = "HS256";

function getTokenExpiresIn() {
  return process.env.JWT_EXPIRES_IN || DEFAULT_TOKEN_EXPIRES_IN;
}

export function signAuthToken(user, jwtSecret = process.env.JWT_SECRET) {
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    jwtSecret,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: getTokenExpiresIn(),
    },
  );
}

export function verifyAuthToken(token, jwtSecret = process.env.JWT_SECRET) {
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }

  return jwt.verify(token, jwtSecret, { algorithms: [JWT_ALGORITHM] });
}
