import test from "node:test";
import assert from "node:assert/strict";
import { signAuthToken, verifyAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";

test("signAuthToken creates a token that verifyAuthToken can read", () => {
  const token = signAuthToken(
    {
      id: "user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
    },
    TEST_JWT_SECRET,
  );

  const payload = verifyAuthToken(token, TEST_JWT_SECRET);

  assert.equal(payload.sub, "user-123");
  assert.equal(payload.email, "ansh@example.com");
  assert.equal(payload.name, "Ansh Sharma");
});

test("signAuthToken requires JWT_SECRET", () => {
  assert.throws(
    () =>
      signAuthToken(
        {
          id: "user-123",
          email: "ansh@example.com",
          name: "Ansh Sharma",
        },
        "",
      ),
    {
      message: "JWT_SECRET is required",
    },
  );
});

test("verifyAuthToken requires JWT_SECRET", () => {
  assert.throws(() => verifyAuthToken("token", ""), {
    message: "JWT_SECRET is required",
  });
});

test("verifyAuthToken rejects invalid tokens", () => {
  assert.throws(() => verifyAuthToken("invalid-token", TEST_JWT_SECRET));
});