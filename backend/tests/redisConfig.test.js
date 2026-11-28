import test from "node:test";
import assert from "node:assert/strict";
import { getRedisConfig } from "../src/config/redis.js";

test("no REDIS_URL means background jobs are disabled", () => {
  const config = getRedisConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.prefix, "conflictfree");
  assert.equal(config.reminderSweepIntervalMs, 60000);
});

test("local Docker Redis URL is accepted without TLS", () => {
  const config = getRedisConfig({ REDIS_URL: "redis://127.0.0.1:6379" });

  assert.equal(config.enabled, true);
  assert.equal(config.tls, false);
});

test("managed providers (Upstash, Redis Cloud) use rediss:// and TLS", () => {
  const config = getRedisConfig({
    REDIS_URL: "rediss://default:secret@example-123.upstash.io:6379",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.tls, true);
});

test("invalid URLs and schemes are rejected", () => {
  assert.throws(() => getRedisConfig({ REDIS_URL: "not a url" }), /valid redis/);
  assert.throws(() => getRedisConfig({ REDIS_URL: "http://localhost:6379" }), /redis:\/\/ or rediss:\/\//);
});

test("BULLMQ_PREFIX must be a safe key namespace", () => {
  assert.equal(getRedisConfig({ BULLMQ_PREFIX: "cf_e2e" }).prefix, "cf_e2e");
  assert.throws(() => getRedisConfig({ BULLMQ_PREFIX: "bad:prefix" }), /BULLMQ_PREFIX/);
});

test("reminder sweep interval is configurable with a 1s floor", () => {
  assert.equal(getRedisConfig({ REMINDER_SWEEP_INTERVAL_MS: "2000" }).reminderSweepIntervalMs, 2000);
  assert.equal(getRedisConfig({ REMINDER_SWEEP_INTERVAL_MS: "10" }).reminderSweepIntervalMs, 60000);
  assert.equal(getRedisConfig({ REMINDER_SWEEP_INTERVAL_MS: "abc" }).reminderSweepIntervalMs, 60000);
});
