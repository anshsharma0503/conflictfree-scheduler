import apiRequest from "./apiClient";

export async function listNotifications({ limit = 20, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });

  if (before) {
    params.set("before", before);
  }

  const response = await apiRequest(`/api/notifications?${params.toString()}`);

  return {
    notifications: response.notifications || [],
    unreadCount: response.unreadCount || 0,
  };
}

export async function markNotificationRead(notificationId) {
  return apiRequest(`/api/notifications/${notificationId}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead() {
  return apiRequest("/api/notifications/read-all", { method: "POST" });
}

export async function getNotificationPreferences() {
  const response = await apiRequest("/api/notifications/preferences");

  return response.preferences;
}

export async function updateNotificationPreferences(preferences) {
  const response = await apiRequest("/api/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify(preferences),
  });

  return response.preferences;
}
