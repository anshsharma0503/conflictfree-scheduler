import apiRequest from "./apiClient";

export async function searchParticipants(query, limit = 10, signal) {
  if (!query || typeof query !== "string") {
    return [];
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const queryParams = new URLSearchParams({
    q: trimmed,
    limit: String(limit),
  });

  const response = await apiRequest(
    `/api/participants/search?${queryParams.toString()}`,
    {
      method: "GET",
      signal,
    },
  );

  return response.participants || [];
}

