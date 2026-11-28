// Gemini settings for the natural-language scheduling assistant (Phase N).
//
// - GEMINI_API_KEY: required to enable the assistant. Without it the rest of
//   the app works and the assistant reports itself as disabled.
// - GEMINI_MODEL / GEMINI_FALLBACK_MODEL: the fallback is tried once when the
//   primary model is overloaded (429/5xx) or times out (Decision 48).
// - GEMINI_TIMEOUT_MS: per-attempt timeout.

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 12_000;
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,80}$/;

function readModel(value, fallback) {
  const model = typeof value === "string" ? value.trim() : "";

  if (!model) {
    return fallback;
  }

  if (!MODEL_NAME_PATTERN.test(model)) {
    throw new Error(`Invalid Gemini model name "${model}"`);
  }

  return model;
}

export function getGeminiConfig(env = process.env) {
  const apiKey = typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY.trim() : "";
  const model = readModel(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
  const fallbackRaw = typeof env.GEMINI_FALLBACK_MODEL === "string" ? env.GEMINI_FALLBACK_MODEL.trim() : undefined;
  // GEMINI_FALLBACK_MODEL=none turns the fallback off.
  const fallbackModel =
    fallbackRaw === "none" ? null : readModel(fallbackRaw, DEFAULT_GEMINI_FALLBACK_MODEL);

  const rawTimeout = Number(env.GEMINI_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout >= 1_000 && rawTimeout <= 60_000
      ? Math.floor(rawTimeout)
      : DEFAULT_TIMEOUT_MS;

  return {
    enabled: Boolean(apiKey),
    apiKey,
    model,
    fallbackModel: fallbackModel && fallbackModel !== model ? fallbackModel : null,
    timeoutMs,
  };
}
