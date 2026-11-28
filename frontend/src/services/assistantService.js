import apiRequest from "./apiClient";

export async function getAssistantStatus() {
  const response = await apiRequest("/api/assistant/status");

  return response.assistant;
}

/** Sends a free-text request; returns `{ request, model }` (the parsed draft). */
export async function parseSchedulingRequest(text) {
  return apiRequest("/api/assistant/parse-request", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}
