import apiRequest from "./apiClient";

export async function listEvents() {
  const response = await apiRequest("/api/events");

  return response.events;
}

export async function createEvent(eventData) {
  const response = await apiRequest("/api/events", {
    method: "POST",
    body: JSON.stringify(eventData),
  });

  return response.event;
}

export async function getEvent(eventId) {
  const response = await apiRequest(`/api/events/${eventId}`);

  return response.event;
}

export async function updateEvent(eventId, eventData) {
  const response = await apiRequest(`/api/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(eventData),
  });

  return response.event;
}

export async function deleteEvent(eventId) {
  const response = await apiRequest(`/api/events/${eventId}`, {
    method: "DELETE",
  });

  return response;
}