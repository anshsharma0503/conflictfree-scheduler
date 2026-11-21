import test from "node:test";
import assert from "node:assert/strict";
import {
  findOrCreateUserFromGoogleProfile,
  loginLocalUser,
  registerLocalUser,
} from "../src/services/authService.js";
import { hashPassword } from "../src/services/passwordService.js";

function createFakeUserModel(existingUser = null) {
  const calls = {
    findOne: [],
    create: [],
    save: 0,
    select: 0,
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

  function createFindOneResult() {
    return {
      select() {
        calls.select += 1;
        return Promise.resolve(fakeExistingUser);
      },
      then(resolve) {
        return Promise.resolve(fakeExistingUser).then(resolve);
      },
    };
  }

  return {
    calls,
    UserModel: {
      findOne(query) {
        calls.findOne.push(query);
        return createFindOneResult();
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

test("findOrCreateUserFromGoogleProfile creates a new user when none exists", async () => {
  const { UserModel, calls } = createFakeUserModel();

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

  assert.deepEqual(calls.findOne, [
    {
      $or: [{ googleId: "google-user-123" }, { email: "ansh@example.com" }],
    },
  ]);

  assert.deepEqual(calls.create, [
    {
      googleId: "google-user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
      avatarUrl: "https://example.com/avatar.png",
      authProvider: "google",
    },
  ]);

  assert.equal(user.id, "new-user-123");
  assert.equal(user.email, "ansh@example.com");
});

test("findOrCreateUserFromGoogleProfile updates an existing user", async () => {
  const { UserModel, calls } = createFakeUserModel({
    id: "existing-user-123",
    googleId: "old-google-id",
    email: "old@example.com",
    name: "Old Name",
    avatarUrl: null,
    authProvider: "local",
  });

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

  assert.equal(calls.save, 1);
  assert.equal(calls.create.length, 0);

  assert.equal(user.id, "existing-user-123");
  assert.equal(user.googleId, "google-user-123");
  assert.equal(user.email, "ansh@example.com");
  assert.equal(user.name, "Ansh Sharma");
  assert.equal(user.avatarUrl, "https://example.com/avatar.png");
  assert.equal(user.authProvider, "google");
});

test("findOrCreateUserFromGoogleProfile requires googleId", async () => {
  await assert.rejects(
    () =>
      findOrCreateUserFromGoogleProfile({
        email: "ansh@example.com",
        name: "Ansh Sharma",
      }),
    {
      message: "Google profile googleId is required",
    },
  );
});

test("findOrCreateUserFromGoogleProfile requires email", async () => {
  await assert.rejects(
    () =>
      findOrCreateUserFromGoogleProfile({
        googleId: "google-user-123",
        name: "Ansh Sharma",
      }),
    {
      message: "Google profile email is required",
    },
  );
});

test("registerLocalUser creates a local user with hashed password", async () => {
  const { UserModel, calls } = createFakeUserModel();

  const user = await registerLocalUser(
    {
      name: "Local User",
      email: "LOCAL@EXAMPLE.COM",
      password: "password123",
    },
    { UserModel },
  );

  assert.deepEqual(calls.findOne, [
    {
      email: "local@example.com",
    },
  ]);

  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].name, "Local User");
  assert.equal(calls.create[0].email, "LOCAL@EXAMPLE.COM");
  assert.equal(calls.create[0].authProvider, "local");
  assert.notEqual(calls.create[0].passwordHash, "password123");

  assert.equal(user.id, "new-user-123");
});

test("registerLocalUser rejects duplicate email", async () => {
  const { UserModel } = createFakeUserModel({
    id: "existing-user-123",
    email: "local@example.com",
  });

  await assert.rejects(
    () =>
      registerLocalUser(
        {
          name: "Local User",
          email: "local@example.com",
          password: "password123",
        },
        { UserModel },
      ),
    {
      message: "An account with this email already exists",
    },
  );
});

test("loginLocalUser returns local user for valid credentials", async () => {
  const passwordHash = await hashPassword("password123");

  const { UserModel, calls } = createFakeUserModel({
    id: "existing-user-123",
    email: "local@example.com",
    name: "Local User",
    passwordHash,
    authProvider: "local",
  });

  const user = await loginLocalUser(
    {
      email: "LOCAL@EXAMPLE.COM",
      password: "password123",
    },
    { UserModel },
  );

  assert.deepEqual(calls.findOne, [
    {
      email: "local@example.com",
    },
  ]);
  assert.equal(calls.select, 1);
  assert.equal(user.id, "existing-user-123");
});

test("loginLocalUser rejects invalid credentials", async () => {
  const { UserModel } = createFakeUserModel(null);

  await assert.rejects(
    () =>
      loginLocalUser(
        {
          email: "missing@example.com",
          password: "password123",
        },
        { UserModel },
      ),
    {
      message: "Invalid email or password",
    },
  );
});

test("loginLocalUser rejects Google-only users", async () => {
  const { UserModel } = createFakeUserModel({
    id: "google-user-123",
    email: "google@example.com",
    authProvider: "google",
    passwordHash: null,
  });

  await assert.rejects(
    () =>
      loginLocalUser(
        {
          email: "google@example.com",
          password: "password123",
        },
        { UserModel },
      ),
    {
      message: "Invalid email or password",
    },
  );
});
test("findOrCreateUserFromGoogleProfile refuses to create an account for an unverified Google email", async () => {
  const { UserModel, calls } = createFakeUserModel();

  await assert.rejects(
    () =>
      findOrCreateUserFromGoogleProfile(
        {
          googleId: "google-unverified",
          email: "new@example.com",
          name: "New User",
          emailVerified: false,
        },
        { UserModel },
      ),
    /not verified/,
  );

  assert.equal(calls.create.length, 0);
});

test("findOrCreateUserFromGoogleProfile refuses to link an existing account by an unverified email", async () => {
  const { UserModel, calls } = createFakeUserModel({
    id: "victim-user",
    googleId: null,
    email: "victim@example.com",
    name: "Victim",
    authProvider: "local",
  });

  await assert.rejects(
    () =>
      findOrCreateUserFromGoogleProfile(
        {
          googleId: "attacker-google-id",
          email: "victim@example.com",
          name: "Attacker",
          emailVerified: false,
        },
        { UserModel },
      ),
    /not verified/,
  );

  assert.equal(calls.save, 0);
});

test("findOrCreateUserFromGoogleProfile still signs in an already-linked Google user", async () => {
  const { UserModel, calls } = createFakeUserModel({
    id: "linked-user",
    googleId: "google-linked",
    email: "linked@example.com",
    name: "Linked",
    authProvider: "google",
  });

  const user = await findOrCreateUserFromGoogleProfile(
    {
      googleId: "google-linked",
      email: "linked@example.com",
      name: "Linked",
    },
    { UserModel },
  );

  assert.equal(user.id, "linked-user");
  assert.equal(calls.save, 1);
});
