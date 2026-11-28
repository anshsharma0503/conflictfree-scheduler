import test from "node:test";
import assert from "node:assert/strict";
import { getGeminiConfig } from "../src/config/gemini.js";
import { createGeminiClient } from "../src/services/assistant/geminiClient.js";

const schema = { type: "object", properties: { a: { type: "string" } } };

function reply(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function answer(data, extra = {}) {
  return reply(200, {
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify(data) }] },
        ...extra,
      },
    ],
  });
}

function recordingFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const next = responses.shift();
    if (typeof next === "function") return next(options);
    return next;
  };
  return { calls, fetchImpl };
}

const input = { systemInstruction: "sys", userText: "hello", responseJsonSchema: schema };

test("config: disabled without a key, defaults and validation", () => {
  assert.equal(getGeminiConfig({}).enabled, false);

  const config = getGeminiConfig({ GEMINI_API_KEY: "k" });
  assert.equal(config.enabled, true);
  assert.equal(config.model, "gemini-3.5-flash-lite");
  assert.equal(config.fallbackModel, "gemini-3.1-flash-lite");
  assert.equal(config.timeoutMs, 12000);

  assert.equal(getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_FALLBACK_MODEL: "none" }).fallbackModel, null);
  assert.equal(
    getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "same", GEMINI_FALLBACK_MODEL: "same" }).fallbackModel,
    null,
  );
  assert.throws(() => getGeminiConfig({ GEMINI_MODEL: "../evil" }), /Invalid Gemini model/);
  assert.equal(getGeminiConfig({ GEMINI_TIMEOUT_MS: "50" }).timeoutMs, 12000);
});

test("sends the key in a header (never the URL), JSON mode, temperature 0, minimal thinking", async () => {
  const { calls, fetchImpl } = recordingFetch([answer({ a: "ok" })]);
  const client = createGeminiClient({ apiKey: "secret-key", model: "m1", fetchImpl });

  const result = await client.generateJson(input);

  assert.deepEqual(result, { data: { a: "ok" }, model: "m1" });
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes("secret-key"));
  assert.match(calls[0].url, /\/models\/m1:generateContent$/);
  assert.equal(calls[0].options.headers["x-goog-api-key"], "secret-key");
  assert.equal(calls[0].body.generationConfig.temperature, 0);
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(calls[0].body.generationConfig.responseJsonSchema, schema);
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingLevel: "minimal" });
  assert.equal(calls[0].body.contents[0].parts[0].text, "hello");
  assert.equal(calls[0].body.systemInstruction.parts[0].text, "sys");
});

test("an overloaded primary model falls back to the second model", async () => {
  const { calls, fetchImpl } = recordingFetch([
    reply(503, { error: { status: "UNAVAILABLE" } }),
    answer({ a: "from fallback" }),
  ]);
  const client = createGeminiClient({ apiKey: "k", model: "m1", fallbackModel: "m2", fetchImpl });

  const result = await client.generateJson(input);

  assert.equal(result.model, "m2");
  assert.deepEqual(result.data, { a: "from fallback" });
  assert.match(calls[1].url, /\/models\/m2:/);
});

test("both models busy twice → one delayed second pass, then 503 with a user-facing message", async () => {
  const busy = () => reply(503, { error: { status: "UNAVAILABLE" } });
  const { calls, fetchImpl } = recordingFetch([busy(), reply(429, {}), busy(), busy()]);
  const sleeps = [];
  const client = createGeminiClient({
    apiKey: "k",
    model: "m1",
    fallbackModel: "m2",
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
  });

  await assert.rejects(client.generateJson(input), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /busy/);
    return true;
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [1500]);
});

test("a short demand spike is absorbed by the second pass", async () => {
  const busy = () => reply(503, {});
  const { fetchImpl } = recordingFetch([busy(), busy(), answer({ a: "recovered" })]);
  const client = createGeminiClient({
    apiKey: "k",
    model: "m1",
    fallbackModel: "m2",
    fetchImpl,
    sleep: async () => {},
  });

  const result = await client.generateJson(input);
  assert.deepEqual(result, { data: { a: "recovered" }, model: "m1" });
});

test("no second pass after a timeout: the user has already waited", async () => {
  const hang = (options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const { calls, fetchImpl } = recordingFetch([hang, reply(503, {})]);
  const client = createGeminiClient({
    apiKey: "k",
    model: "m1",
    fallbackModel: "m2",
    timeoutMs: 30,
    fetchImpl,
    sleep: async () => assert.fail("must not sleep"),
  });

  await assert.rejects(client.generateJson(input), (error) => error.status === 504);
  assert.equal(calls.length, 2);
});

test("a model that rejects minimal thinking is retried without it", async () => {
  const { calls, fetchImpl } = recordingFetch([
    reply(400, { error: { message: "Thinking level MINIMAL is not supported for this model." } }),
    answer({ a: "ok" }),
  ]);
  const client = createGeminiClient({ apiKey: "k", model: "m1", fetchImpl });

  const result = await client.generateJson(input);

  assert.equal(result.data.a, "ok");
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined);
});

test("configuration errors (bad key, retired model) do not try the fallback", async () => {
  const { calls, fetchImpl } = recordingFetch([reply(404, { error: { status: "NOT_FOUND" } })]);
  const client = createGeminiClient({ apiKey: "k", model: "m1", fallbackModel: "m2", fetchImpl });

  await assert.rejects(client.generateJson(input), (error) => error.status === 502);
  assert.equal(calls.length, 1);
});

test("a timeout aborts the request and reports 504", async () => {
  const hang = (options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const { fetchImpl } = recordingFetch([hang]);
  const client = createGeminiClient({ apiKey: "k", model: "m1", timeoutMs: 50, fetchImpl });

  await assert.rejects(client.generateJson(input), (error) => error.status === 504);
});

test("network failures count as unavailable and use the fallback", async () => {
  const { fetchImpl } = recordingFetch([
    () => Promise.reject(new TypeError("fetch failed")),
    answer({ a: "ok" }),
  ]);
  const client = createGeminiClient({ apiKey: "k", model: "m1", fallbackModel: "m2", fetchImpl });

  assert.equal((await client.generateJson(input)).model, "m2");
});

test("unreadable or blocked answers become clear errors", async () => {
  const broken = createGeminiClient({
    apiKey: "k",
    model: "m1",
    fetchImpl: recordingFetch([reply(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }] })]).fetchImpl,
  });
  await assert.rejects(broken.generateJson(input), (error) => error.status === 502);

  const blocked = createGeminiClient({
    apiKey: "k",
    model: "m1",
    fetchImpl: recordingFetch([reply(200, { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] })]).fetchImpl,
  });
  await assert.rejects(blocked.generateJson(input), (error) => error.status === 422);

  const promptBlocked = createGeminiClient({
    apiKey: "k",
    model: "m1",
    fetchImpl: recordingFetch([reply(200, { promptFeedback: { blockReason: "OTHER" } })]).fetchImpl,
  });
  await assert.rejects(promptBlocked.generateJson(input), (error) => error.status === 422);
});
