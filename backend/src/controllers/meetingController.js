import {
  confirmSharedMeeting,
  listPendingInvitations,
  respondToInvitation,
  cancelMeeting as cancelMeetingService,
} from "../services/meetingService.js";
import {
  publishInvitationResponded,
  publishMeetingCancelled,
  publishMeetingConfirmed,
} from "../services/schedulingEvents.js";

export async function confirmMeeting(req, res) {
  try {
    const rawResourceId =
      req.body.resourceId !== undefined ? req.body.resourceId : req.body.resource;
    const resourceId =
      rawResourceId && typeof rawResourceId === "string" && rawResourceId.trim()
        ? rawResourceId.trim()
        : null;

    const meeting = await confirmSharedMeeting({
      organizerId: req.user.id,
      title: req.body.title,
      description: req.body.description,
      startAt: req.body.startAt,
      endAt: req.body.endAt,
      timezone: req.body.timezone || req.user.timezone,
      location: req.body.location,
      participantEmails: req.body.participantEmails,
      resourceId,
      attendeeCount: req.body.attendeeCount,
    });

    publishMeetingConfirmed(meeting);

    return res.status(201).json({
      success: true,
      meeting,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function getInvitations(req, res) {
  try {
    const invitations = await listPendingInvitations({
      userId: req.user.id,
      userEmail: req.user.email,
    });

    return res.status(200).json({
      success: true,
      invitations,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function respondInvitation(req, res) {
  try {
    const meeting = await respondToInvitation({
      meetingId: req.params.id,
      userId: req.user.id,
      userEmail: req.user.email,
      status: req.body.status,
    });

    publishInvitationResponded(meeting, {
      responderId: req.user.id,
      status: req.body.status,
    });

    return res.status(200).json({
      success: true,
      message: `Invitation ${req.body.status} successfully`,
      meeting,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function cancelMeeting(req, res) {
  try {
    const meeting = await cancelMeetingService({
      meetingId: req.params.id,
      userId: req.user.id,
    });

    publishMeetingCancelled(meeting);

    return res.status(200).json({
      success: true,
      message: "Meeting cancelled successfully",
      meeting,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

