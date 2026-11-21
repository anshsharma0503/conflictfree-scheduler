import apiRequest from "./apiClient";

export async function listResources() {
  const response = await apiRequest("/api/resources");
  return response.resources || [];
}

export async function getResource(id) {
  const response = await apiRequest(`/api/resources/${id}`);
  return response.resource;
}

export async function createResource(resourceData) {
  const response = await apiRequest("/api/resources", {
    method: "POST",
    body: JSON.stringify(resourceData),
  });
  return response.resource;
}

export async function updateResource(id, resourceData) {
  const response = await apiRequest(`/api/resources/${id}`, {
    method: "PATCH",
    body: JSON.stringify(resourceData),
  });
  return response.resource;
}

export async function deleteResource(id) {
  const response = await apiRequest(`/api/resources/${id}`, {
    method: "DELETE",
  });
  return response;
}

