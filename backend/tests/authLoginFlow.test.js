import test from "node:test";
import assert from "node:assert/strict";
import { findOrCreateUserFromGoogleProfile } from "../src/services/authService.js";
import { signAuthToken, verifyAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";

function createFakeUserModel(existingUser = null) {
  const calls = {
    findOne: [],
    create: [],
    save: 0,
  };

  const fakeExistingUser = existingUser
    ? {
        ...existingUser,
        async save() {
          calls.save += 1;
          return this;
        },
      }
    : null;

  return {
    calls,
    UserModel: {
      async findOne(query) {
        calls.findOne.push(query);
        return fakeExistingUser;
      },
      async create(payload) {
        calls.create.push(payload);

        return {
          id: "new-user-123",
          timezone: "UTC",
          ...payload,
        };
      },
    },
  };
}

test("Google profile can become an app user and app JWT", async () => {
  const { UserModel } = createFakeUserModel();

  const user = await findOrCreateUserFromGoogleProfile(
    {
      googleId: "google-user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
      avatarUrl: "https://example.com/avatar.png",
      emailVerified: true,
    },
    { UserModel },
  );

  const token = signAuthToken(user, TEST_JWT_SECRET);
  const payload = verifyAuthToken(token, TEST_JWT_SECRET);

  assert.equal(user.id, "new-user-123");
  assert.equal(user.email, "ansh@example.com");

  assert.equal(payload.sub, "new-user-123");
  assert.equal(payload.email, "ansh@example.com");
  assert.equal(payload.name, "Ansh Sharma");
});