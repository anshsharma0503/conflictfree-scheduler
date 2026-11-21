import apiRequest from "./apiClient";

export async function confirmSharedMeeting(meetingData) {
  const response = await apiRequest("/api/meetings/confirm", {
    method: "POST",
    body: JSON.stringify(meetingData),
  });

  return response.meeting;
}

export async function listInvitations() {
  const response = await apiRequest("/api/meetings/invitations");

  return response.invitations;
}

export async function respondToInvitation(meetingId, actionOrStatus) {
  const status =
    typeof actionOrStatus === "object"
      ? actionOrStatus.status || actionOrStatus.action
      : actionOrStatus;

  const response = await apiRequest(
    `/api/meetings/${meetingId}/invitation-response`,
    {
      method: "PATCH",
      body: JSON.stringify({ status, action: status }),
    },
  );

  return response.meeting;
}

export async function cancelMeeting(meetingId) {
  const response = await apiRequest(`/api/meetings/${meetingId}/cancel`, {
    method: "POST",
  });

  return response.meeting;
}
