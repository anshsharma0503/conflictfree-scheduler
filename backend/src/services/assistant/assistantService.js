import { getGeminiConfig } from "../../config/gemini.js";
import { searchParticipants } from "../search/participantSearchService.js";
import { createGeminiClient } from "./geminiClient.js";
import { createRateLimiter } from "./rateLimiter.js";
import { parseSchedulingRequest } from "./schedulingRequestParser.js";

export const ASSISTANT_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60_000 });

let client = null;
let clientOverride = null;
const limiter = createRateLimiter(ASSISTANT_RATE_LIMIT);

function getClient() {
  if (clientOverride) {
    return clientOverride;
  }

  if (!client) {
    const config = getGeminiConfig();

    if (!config.enabled) {
      return null;
    }

    client = createGeminiClient(config);
  }

  return client;
}

/** Tests only: swap the Gemini client for a double (null restores). */
export function setAssistantClientForTests(testClient) {
  clientOverride = testClient;
  limiter.reset();
}

export function getAssistantStatus() {
  const active = getClient();

  return {
    enabled: Boolean(active),
    model: active?.model || null,
  };
}

export function takeAssistantQuota(userId) {
  return limiter.take(String(userId));
}

/**
 * Resolves one name or email to registered users through the participant
 * Trie. An exact email or exact full-name match wins over prefix matches,
 * so "Alex Kumar" is not ambiguous just because "Alex Kumarswamy" exists.
 */
export function createParticipantResolver({ organizerId, organizerEmail, search = searchParticipants }) {
  return async function resolveParticipant(query) {
    let results = [];

    try {
      results = await search({ query, limit: 6, organizerId, organizerEmail });
    } catch {
      return [];
    }

    const lowered = query.toLowerCase();
    const exact = results.filter(
      (user) => user.email.toLowerCase() === lowered || user.name.toLowerCase() === lowered,
    );
    const chosen = exact.length > 0 ? exact : results;

    return chosen.map((user) => ({ id: String(user.id), name: user.name, email: user.email }));
  };
}

export async function interpretSchedulingRequest({ text, user, now = new Date() }) {
  const active = getClient();

  if (!active) {
    const error = new Error("The scheduling assistant is not configured on this server.");
    error.status = 503;
    throw error;
  }

  return parseSchedulingRequest({
    text,
    timezone: user.timezone || "UTC",
    now,
    client: active,
    resolveParticipant: createParticipantResolver({
      organizerId: user.id,
      organizerEmail: user.email,
    }),
  });
}
