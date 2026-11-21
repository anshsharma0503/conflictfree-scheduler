async function readJsonSafely(response) {
  if (response.status === 204) {
    return {};
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(path, {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    const networkError = new Error("Unable to reach the ConflictFree server. Check your connection.");
    networkError.status = 0;
    throw networkError;
  }

  const data = await readJsonSafely(response);

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || `Request failed (HTTP ${response.status ?? "error"})`,
    );
    error.status = response.status;
    throw error;
  }

  if (data === null) {
    const error = new Error("The server returned an unexpected response.");
    error.status = response.status;
    throw error;
  }

  return data;
}

export default apiRequest;
