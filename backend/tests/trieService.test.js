import assert from "node:assert/strict";
import test from "node:test";
import { Trie } from "../src/services/search/trieService.js";

test("Trie inserts and finds matching prefix", () => {
  const trie = new Trie();
  const user = {
    id: "user-1",
    name: "Alice Johnson",
    email: "alice@example.com",
    timezone: "America/New_York",
  };

  trie.indexUser(user);

  const results = trie.searchPrefix("ali");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "user-1");
  assert.equal(results[0].name, "Alice Johnson");
  assert.equal(results[0].email, "alice@example.com");
  assert.equal(results[0].timezone, "America/New_York");
});

test("Trie matches case-insensitively by name", () => {
  const trie = new Trie();
  const user = {
    id: "user-2",
    name: "Raj Patel",
    email: "raj@example.com",
    timezone: "Asia/Kolkata",
  };

  trie.indexUser(user);

  const lowerResults = trie.searchPrefix("raj");
  assert.equal(lowerResults.length, 1);
  assert.equal(lowerResults[0].name, "Raj Patel");

  const upperResults = trie.searchPrefix("RAJ");
  assert.equal(upperResults.length, 1);
  assert.equal(upperResults[0].name, "Raj Patel");

  const mixedResults = trie.searchPrefix("rAj");
  assert.equal(mixedResults.length, 1);
  assert.equal(mixedResults[0].name, "Raj Patel");

  // Also matches by last name prefix
  const lastNameResults = trie.searchPrefix("pat");
  assert.equal(lastNameResults.length, 1);
  assert.equal(lastNameResults[0].name, "Raj Patel");
});

test("Trie matches case-insensitively by email", () => {
  const trie = new Trie();
  const user = {
    id: "user-3",
    name: "Sarah Connor",
    email: "sarah.connor@cyberdyne.org",
    timezone: "America/Los_Angeles",
  };

  trie.indexUser(user);

  const emailResults = trie.searchPrefix("sarah.c");
  assert.equal(emailResults.length, 1);
  assert.equal(emailResults[0].email, "sarah.connor@cyberdyne.org");

  const upperEmailResults = trie.searchPrefix("SARAH.CONNOR@CYBER");
  assert.equal(upperEmailResults.length, 1);
  assert.equal(upperEmailResults[0].email, "sarah.connor@cyberdyne.org");
});

test("Trie deduplicates when user matches across name and email", () => {
  const trie = new Trie();
  const user = {
    id: "user-4",
    name: "Marcus Wright",
    email: "marcus@resistance.net",
    timezone: "UTC",
  };

  trie.indexUser(user);

  // Both name "Marcus" and email "marcus" match prefix "mar"
  const results = trie.searchPrefix("mar");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "user-4");
});

test("Trie respects configurable limits and clamps maximum to 20", () => {
  const trie = new Trie();

  for (let i = 1; i <= 25; i++) {
    trie.indexUser({
      id: `user-${i}`,
      name: `Test User ${i}`,
      email: `test${i}@example.com`,
      timezone: "UTC",
    });
  }

  // Default limit is 10
  const defaultResults = trie.searchPrefix("test");
  assert.equal(defaultResults.length, 10);

  // Custom limit of 5
  const customResults = trie.searchPrefix("test", 5);
  assert.equal(customResults.length, 5);

  // Exceeding max limit (25 requested) gets clamped to 20
  const maxResults = trie.searchPrefix("test", 25);
  assert.equal(maxResults.length, 20);
});

test("Trie returns empty array when no matches exist or invalid prefix", () => {
  const trie = new Trie();
  trie.indexUser({
    id: "user-5",
    name: "John Doe",
    email: "john@example.com",
    timezone: "UTC",
  });

  assert.deepEqual(trie.searchPrefix("xyz"), []);
  assert.deepEqual(trie.searchPrefix(""), []);
  assert.deepEqual(trie.searchPrefix(null), []);
  assert.deepEqual(trie.searchPrefix(undefined), []);
  assert.deepEqual(trie.searchPrefix("   "), []);
});

test("Trie excludes sensitive fields from stored results", () => {
  const trie = new Trie();
  const rawUser = {
    _id: "mongo-user-id",
    name: "Secure User",
    email: "SECURE@EXAMPLE.COM",
    timezone: "UTC",
    passwordHash: "$2a$10$secretHashValueNotToBeReturned",
    googleId: "google-oauth-id-12345",
    token: "jwt-token-string",
    createdAt: new Date(),
    events: ["event-1", "event-2"],
  };

  trie.indexUser(rawUser);

  const results = trie.searchPrefix("sec");
  assert.equal(results.length, 1);

  const userResult = results[0];
  assert.equal(userResult.id, "mongo-user-id");
  assert.equal(userResult.name, "Secure User");
  assert.equal(userResult.email, "secure@example.com");
  assert.equal(userResult.timezone, "UTC");

  // Ensure sensitive properties are undefined
  assert.equal(userResult.passwordHash, undefined);
  assert.equal(userResult.googleId, undefined);
  assert.equal(userResult.token, undefined);
  assert.equal(userResult.events, undefined);
});

