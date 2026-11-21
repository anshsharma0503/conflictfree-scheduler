import test from "node:test";
import assert from "node:assert/strict";
import User from "../src/models/User.js";

test("User model accepts a valid Google OAuth user", async () => {
  const user = new User({
    googleId: "google-123",
    email: " ANSH@EXAMPLE.COM ",
    name: " Ansh Sharma ",
    avatarUrl: " https://example.com/avatar.png ",
    timezone: " Asia/Kolkata ",
    authProvider: "google",
  });

  await user.validate();

  assert.equal(user.email, "ansh@example.com");
  assert.equal(user.name, "Ansh Sharma");
  assert.equal(user.googleId, "google-123");
  assert.equal(user.avatarUrl, "https://example.com/avatar.png");
  assert.equal(user.timezone, "Asia/Kolkata");
  assert.equal(user.authProvider, "google");
});

test("User model accepts a valid local user", async () => {
  const user = new User({
    email: " LOCAL@EXAMPLE.COM ",
    name: " Local User ",
    passwordHash: "hashed-password",
    authProvider: "local",
  });

  await user.validate();

  assert.equal(user.email, "local@example.com");
  assert.equal(user.name, "Local User");
  assert.equal(user.passwordHash, "hashed-password");
  assert.equal(user.authProvider, "local");
});

test("User model uses UTC as the default timezone", async () => {
  const user = new User({
    googleId: "google-456",
    email: "user@example.com",
    name: "Test User",
    authProvider: "google",
  });

  await user.validate();

  assert.equal(user.timezone, "UTC");
});

test("User model requires email and name", async () => {
  const user = new User({});

  await assert.rejects(() => user.validate(), {
    name: "ValidationError",
  });
});

test("User model requires googleId for Google users", async () => {
  const user = new User({
    email: "google@example.com",
    name: "Google User",
    authProvider: "google",
  });

  await assert.rejects(() => user.validate(), {
    name: "ValidationError",
  });
});

test("User model requires passwordHash for local users", async () => {
  const user = new User({
    email: "local@example.com",
    name: "Local User",
    authProvider: "local",
  });

  await assert.rejects(() => user.validate(), {
    name: "ValidationError",
  });
});

test("User model rejects invalid email addresses", async () => {
  const user = new User({
    googleId: "google-789",
    email: "not-an-email",
    name: "Invalid Email User",
    authProvider: "google",
  });

  await assert.rejects(() => user.validate(), {
    name: "ValidationError",
  });
});