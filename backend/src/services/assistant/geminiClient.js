// Minimal Gemini REST client for structured JSON output.
//
// Uses the public generateContent endpoint through `fetch` (no SDK). The API
// key travels only in the `x-goog-api-key` header, never in a URL, so it
// cannot leak through logs or proxies. Nothing here logs prompt text.
import { logger } from "../logger.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
// Rounds over [primary, fallback] when every model is busy (Decision 48).
const BUSY_ROUNDS = 2;

export class AssistantError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "AssistantError";
    this.status = status;
    this.code = code;
  }
}

function extractText(body) {
  const candidate = body?.candidates?.[0];

  if (!candidate) {
    const blockReason = body?.promptFeedback?.blockReason;
    throw new AssistantError(
      blockReason
        ? "That request could not be processed. Try rephrasing it."
        : "The assistant returned no answer.",
      blockReason ? 422 : 502,
      blockReason ? "blocked" : "empty_response",
    );
  }

  if (candidate.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)) {
    throw new AssistantError(
      "That request could not be processed. Try rephrasing it.",
      422,
      "blocked",
    );
  }

  // Thinking models may return "thought" parts; only the answer counts.
  return (candidate.content?.parts || [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {string|null} [options.fallbackModel]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests
 */
export function createGeminiClient({
  apiKey,
  model,
  fallbackModel = null,
  timeoutMs = 12_000,
  busyRetryDelayMs = 1_500,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!apiKey) {
    throw new Error("createGeminiClient requires an apiKey");
  }

  async function callModel(modelName, payload, { withThinking }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    const generationConfig = { ...payload.generationConfig };
    if (withThinking) {
      // Parsing a sentence needs no reasoning; minimal thinking cut latency
      // from ~60s to ~2s in measurements (Decision 48).
      generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
    }

    try {
      const response = await fetchImpl(`${API_BASE}/${encodeURIComponent(modelName)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({ ...payload, generationConfig }),
        signal: controller.signal,
      });

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      return { status: response.status, ok: response.ok, body };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { status: 504, ok: false, body: null, timedOut: true };
      }

      return { status: 503, ok: false, body: null, networkError: error?.message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sends one prompt and returns `{ data, model }`, where `data` is the
   * parsed JSON answer. Tries the fallback model when the primary is
   * overloaded, unavailable, or too slow; if both are briefly busy, waits
   * `busyRetryDelayMs` and tries both once more.
   */
  async function generateJson({ systemInstruction, userText, responseJsonSchema }) {
    const payload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    };

    const models = [model, fallbackModel].filter(Boolean);

    // One pass over [primary, fallback]. Returns the answer, or the failure
    // that ended the pass plus whether any attempt timed out.
    async function tryModels() {
      let failure = null;
      let timedOut = false;

      for (const modelName of models) {
        const started = Date.now();
        let result = await callModel(modelName, payload, { withThinking: true });

        // Some models reject the minimal thinking level; retry once without it.
        if (result.status === 400 && /thinking/i.test(result.body?.error?.message || "")) {
          result = await callModel(modelName, payload, { withThinking: false });
        }

        logger.info("assistant_model_call", {
          model: modelName,
          status: result.status,
          latencyMs: Date.now() - started,
          timedOut: Boolean(result.timedOut),
        });

        if (result.ok) {
          const text = extractText(result.body);

          try {
            return { answer: { data: JSON.parse(text), model: modelName } };
          } catch {
            throw new AssistantError("The assistant returned an unreadable answer.", 502, "bad_json");
          }
        }

        failure = result;
        timedOut = timedOut || Boolean(result.timedOut);

        // 400/401/403/404 are configuration problems: another model won't help.
        if (!RETRYABLE_STATUSES.has(result.status) && !result.timedOut) {
          break;
        }
      }

      return { failure, timedOut };
    }

    let pass = await tryModels();

    // Every model answered "busy" quickly: demand spikes are often over
    // within seconds, so wait briefly and try one more pass. Never after a
    // timeout, which would make the user wait far too long.
    for (let round = 1; round < BUSY_ROUNDS && !pass.answer; round += 1) {
      if (pass.timedOut || !RETRYABLE_STATUSES.has(pass.failure?.status)) {
        break;
      }
      await sleep(busyRetryDelayMs);
      pass = await tryModels();
    }

    if (pass.answer) {
      return pass.answer;
    }

    const lastFailure = pass.failure;

    if (pass.timedOut && RETRYABLE_STATUSES.has(lastFailure?.status)) {
      throw new AssistantError(
        "The assistant took too long to answer. Try again, or fill in the form yourself.",
        504,
        "timeout",
      );
    }

    if (lastFailure && RETRYABLE_STATUSES.has(lastFailure.status)) {
      throw new AssistantError(
        "The assistant is busy right now. Try again in a moment, or fill in the form yourself.",
        503,
        "unavailable",
      );
    }

    // 400/401/403/404: configuration problems (bad key, retired model).
    logger.error("assistant_upstream_rejected", {
      status: lastFailure?.status,
      upstreamStatus: lastFailure?.body?.error?.status,
    });
    throw new AssistantError("The assistant is not available.", 502, "upstream_error");
  }

  return { generateJson, model, fallbackModel };
}
