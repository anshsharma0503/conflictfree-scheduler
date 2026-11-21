import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/services/passwordService.js";

test("hashPassword hashes a valid password", async () => {
  const passwordHash = await hashPassword("password123");

  assert.notEqual(passwordHash, "password123");
  assert.equal(await verifyPassword("password123", passwordHash), true);
});

test("hashPassword rejects short passwords", async () => {
  await assert.rejects(() => hashPassword("short"), {
    message: "Password must be at least 8 characters",
  });
});

test("verifyPassword returns false for wrong password", async () => {
  const passwordHash = await hashPassword("password123");

  assert.equal(await verifyPassword("wrongpassword", passwordHash), false);
});

test("verifyPassword returns false when password or hash is missing", async () => {
  assert.equal(await verifyPassword("", "hash"), false);
  assert.equal(await verifyPassword("password123", ""), false);
});