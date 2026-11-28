import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { useRealtimeUpdates } from "../hooks/useRealtimeUpdates";
import { DashboardContext } from "./dashboardContext";
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from "../services/eventService";
import {
  checkEventConflicts,
  findAvailableSlots,
  findSmartSuggestions,
} from "../services/schedulingService";
import {
  createResource,
  deleteResource,
  listResources,
  updateResource,
} from "../services/resourceService";
import {
  cancelMeeting,
  confirmSharedMeeting,
  listInvitations,
  respondToInvitation,
} from "../services/meetingService";
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from "../services/notificationService";
import { getAssistantStatus } from "../services/assistantService";
import {
  formatEventTime,
  normalizeTimezone,
  toDateTimeLocalValue,
  toIsoDate,
} from "../utils/timezone";

function getInitialFormData(userTimezone = "UTC") {
  return {
    title: "",
    description: "",
    startAt: "",
    endAt: "",
    timezone: userTimezone,
    location: "",
    resourceId: "",
    attendeeCount: "",
  };
}

const initialSlotSearchData = {
  windowStart: "",
  windowEnd: "",
  durationMinutes: 60,
  slotStepMinutes: 30,
  participantEmails: "",
  preferredStartHour: "",
  preferredEndHour: "",
  avoidEarlyMorning: false,
  avoidLateDay: false,
  earliestSlotBonus: false,
  minimumScore: "",
  maxSuggestions: 3,
  resourceId: "",
  attendeeCount: "",
  autoAllocateResource: false,
  resourceType: "",
};

const initialResourceFormData = {
  name: "",
  type: "room",
  capacity: 1,
  location: "",
  description: "",
};

function parseParticipantEmails(input) {
  if (!input || typeof input !== "string") {
    return [];
  }

  return input
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

// Personal events never carry participants: the backend rejects a non-empty
// `participants` array on /api/events. People are invited through
// POST /api/meetings/confirm (handleConfirmSharedMeeting) instead.
function getFormDataFromEvent(event, userTimezone = "UTC") {
  return {
    title: event.title || "",
    description: event.description || "",
    startAt: toDateTimeLocalValue(event.startAt, userTimezone),
    endAt: toDateTimeLocalValue(event.endAt, userTimezone),
    timezone: event.timezone || userTimezone,
    location: event.location || "",
    resourceId: event.resource || event.resourceDetails?.id || "",
    attendeeCount: "",
  };
}

function sortEventsByStartAt(events) {
  return [...events].sort(
    (firstEvent, secondEvent) =>
      new Date(firstEvent.startAt) - new Date(secondEvent.startAt),
  );
}

function upsertById(items, item) {
  if (!item?.id) {
    return items;
  }

  const exists = items.some((existing) => existing.id === item.id);

  return exists
    ? items.map((existing) => (existing.id === item.id ? { ...existing, ...item } : existing))
    : [...items, item];
}

const MAX_NOTIFICATIONS = 50;

function getEventsStatus(loadedEvents) {
  return loadedEvents.length ? `${loadedEvents.length} event(s) loaded` : "No events yet";
}

/**
 * Owns all dashboard data and actions so the split pages
 * (overview, events, composer, find a time, resources) share one state.
 * Selecting a slot on "Find a time" fills the same form the composer edits.
 */
function DashboardProvider({ children }) {
  const { user, logoutUser } = useAuth();
  const userTimezone = normalizeTimezone(user?.timezone, "UTC");

  const [events, setEvents] = useState([]);
  const [formData, setFormData] = useState(() => getInitialFormData(userTimezone));
  const [editingEventId, setEditingEventId] = useState(null);
  const [statusMessage, setStatusMessage] = useState("Loading events...");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [conflictWarning, setConflictWarning] = useState([]);

  const [slotSearchData, setSlotSearchData] = useState(initialSlotSearchData);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [hasSearchedSlots, setHasSearchedSlots] = useState(false);
  const [isSearchingSlots, setIsSearchingSlots] = useState(false);
  const [slotSearchError, setSlotSearchError] = useState("");

  const [selectedParticipants, setSelectedParticipants] = useState([]);
  const [pickedParticipants, setPickedParticipants] = useState([]);
  const [participantSearchQuery, setParticipantSearchQuery] = useState("");
  const [smartSuggestions, setSmartSuggestions] = useState([]);
  const [suggestionMeta, setSuggestionMeta] = useState(null);
  const [hasSearchedSuggestions, setHasSearchedSuggestions] = useState(false);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");

  const [resources, setResources] = useState([]);
  const [selectedSlotResource, setSelectedSlotResource] = useState(null);
  const [resourceFormData, setResourceFormData] = useState(initialResourceFormData);
  const [editingResourceId, setEditingResourceId] = useState(null);
  const [resourceError, setResourceError] = useState("");
  const [isSavingResource, setIsSavingResource] = useState(false);

  const [invitations, setInvitations] = useState([]);
  const [invitationMessage, setInvitationMessage] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [isConfirmingMeeting, setIsConfirmingMeeting] = useState(false);
  // True when a pushed change (booking, meeting, or event) may have made
  // the shown slot results out of date. Results are never silently re-run.
  const [availabilityStale, setAvailabilityStale] = useState(false);

  // In-app notifications (Phase M). Newest first; capped so a long session
  // does not grow without bound.
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationPreferences, setNotificationPreferences] = useState(null);
  const [notificationError, setNotificationError] = useState("");
  // Gemini scheduling assistant (Phase N); hidden unless the server has it.
  const [assistantStatus, setAssistantStatus] = useState({ enabled: false, model: null });

  const isEditing = Boolean(editingEventId);

  // When the account's time zone changes (sidebar "Use <zone>"), keep the
  // composer's zone in step unless the user picked a different one by hand.
  const previousTimezoneRef = useRef(userTimezone);
  useEffect(() => {
    const previous = previousTimezoneRef.current;
    previousTimezoneRef.current = userTimezone;

    if (previous !== userTimezone) {
      setFormData((current) =>
        current.timezone === previous ? { ...current, timezone: userTimezone } : current,
      );
    }
  }, [userTimezone]);

  function formatTime(isoDate) {
    return formatEventTime(isoDate, userTimezone);
  }

  async function loadEvents() {
    try {
      const loadedEvents = await listEvents();

      setEvents(loadedEvents);
      setStatusMessage(getEventsStatus(loadedEvents));
    } catch (loadError) {
      setError(loadError.message);
      setStatusMessage("Unable to load events");
    }
  }

  async function loadInvitations() {
    try {
      const loadedInvitations = await listInvitations();
      setInvitations(loadedInvitations || []);
    } catch {
      // Invitations are optional on the dashboard; a failure is non-fatal.
    }
  }

  async function loadResources() {
    try {
      setResources(await listResources());
    } catch {
      // Resources are optional on the dashboard; a failure is non-fatal.
    }
  }

  async function loadNotifications() {
    try {
      const result = await listNotifications();
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    } catch {
      // Notifications are optional on the dashboard; a failure is non-fatal.
    }
  }

  function applyPushedNotification({ notification, unreadCount: pushedCount } = {}) {
    if (!notification?.id) return;

    setNotifications((current) =>
      [notification, ...current.filter((item) => item.id !== notification.id)].slice(
        0,
        MAX_NOTIFICATIONS,
      ),
    );

    if (typeof pushedCount === "number") {
      setUnreadCount(pushedCount);
    }

    if (notification.type === "event.reminder") {
      setStatusMessage(`Reminder: ${notification.message}`);
    }
  }

  // Another tab (or this one) marked notifications as read.
  function applyNotificationsRead({ notificationIds = [], all = false, unreadCount: pushedCount } = {}) {
    setNotifications((current) =>
      current.map((item) =>
        all || notificationIds.includes(item.id) ? { ...item, read: true } : item,
      ),
    );

    if (typeof pushedCount === "number") {
      setUnreadCount(pushedCount);
    }
  }

  function applyPushedEvent(record) {
    if (!record?.id) return;
    setEvents((current) => sortEventsByStartAt(upsertById(current, record)));
  }

  function markAvailabilityStale() {
    setAvailabilityStale(true);
  }

  function handleMeetingPush({ meeting } = {}) {
    applyPushedEvent(meeting);
    loadInvitations();
    markAvailabilityStale();
  }

  const realtimeStatus = useRealtimeUpdates({
    enabled: Boolean(user),
    handlers: {
      "event:created": ({ event } = {}) => {
        applyPushedEvent(event);
        markAvailabilityStale();
      },
      "event:updated": ({ event } = {}) => {
        applyPushedEvent(event);
        markAvailabilityStale();
      },
      "event:deleted": ({ eventId } = {}) => {
        setEvents((current) => current.filter((item) => item.id !== eventId));
        setInvitations((current) => current.filter((item) => item.id !== eventId));
        markAvailabilityStale();
      },
      "meeting:confirmed": handleMeetingPush,
      "meeting:updated": handleMeetingPush,
      "meeting:cancelled": handleMeetingPush,
      "invitation:accepted": handleMeetingPush,
      "invitation:declined": handleMeetingPush,
      "invitation:created": (payload = {}) => {
        handleMeetingPush(payload);
        if (payload.meeting?.title) {
          setInvitationMessage(`New invitation: ${payload.meeting.title}`);
        }
      },
      "resource:created": ({ resource } = {}) => {
        if (resource?.isActive !== false) {
          setResources((current) =>
            upsertById(current, resource).sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      },
      "resource:updated": ({ resource } = {}) => {
        setResources((current) =>
          upsertById(current, resource).sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      "resource:deactivated": ({ resource } = {}) => {
        setResources((current) => current.filter((item) => item.id !== resource?.id));
        markAvailabilityStale();
      },
      "resource:booking-changed": markAvailabilityStale,
      "notification:created": applyPushedNotification,
      "notification:read": applyNotificationsRead,
    },
    onResync: () => {
      loadEvents();
      loadInvitations();
      loadResources();
      loadNotifications();
      markAvailabilityStale();
    },
    onSessionExpired: () => {
      setError("Your session has expired. Please sign in again.");
      logoutUser?.();
    },
  });

  useEffect(() => {
    let isActive = true;

    listEvents()
      .then((loadedEvents) => {
        if (isActive) {
          setEvents(loadedEvents);
          setStatusMessage(getEventsStatus(loadedEvents));
        }
      })
      .catch((loadError) => {
        if (isActive) {
          setError(loadError.message);
          setStatusMessage("Unable to load events");
        }
      });

    listResources()
      .then((loadedResources) => {
        if (isActive) {
          setResources(loadedResources);
        }
      })
      .catch(() => {
        // Resources are optional on the dashboard; a failure is non-fatal.
      });

    listInvitations()
      .then((loadedInvitations) => {
        if (isActive) {
          setInvitations(loadedInvitations || []);
        }
      })
      .catch(() => {
        // Invitations are optional on the dashboard; a failure is non-fatal.
      });

    listNotifications()
      .then((result) => {
        if (isActive) {
          setNotifications(result.notifications);
          setUnreadCount(result.unreadCount);
        }
      })
      .catch(() => {
        // Notifications are optional on the dashboard; a failure is non-fatal.
      });

    getNotificationPreferences()
      .then((preferences) => {
        if (isActive && preferences) {
          setNotificationPreferences(preferences);
        }
      })
      .catch(() => {
        // Without preferences the reminder setting is simply hidden.
      });

    getAssistantStatus()
      .then((status) => {
        if (isActive && status) {
          setAssistantStatus(status);
        }
      })
      .catch(() => {
        // The assistant is optional; without a status it stays hidden.
      });

    return () => {
      isActive = false;
    };
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    if (name === "startAt" || name === "endAt") {
      setConflictWarning([]);
    }

    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  }

  function handleSlotSearchChange(event) {
    const { name, value, type, checked } = event.target;
    setSlotSearchError("");

    setSlotSearchData((currentData) => ({
      ...currentData,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleAutoAllocateChange(event) {
    const { checked } = event.target;

    setSlotSearchData((currentData) => ({
      ...currentData,
      autoAllocateResource: checked,
      resourceId: checked ? "" : currentData.resourceId,
    }));
  }

  function resetForm() {
    setFormData(getInitialFormData(userTimezone));
    setEditingEventId(null);
    setConflictWarning([]);
  }

  function handleEditEvent(event) {
    setError("");
    setConflictWarning([]);
    setEditingEventId(event.id);
    setFormData(getFormDataFromEvent(event, userTimezone));
    setStatusMessage(`Editing "${event.title}"`);
  }

  function addAllocatedResource(allocatedResource) {
    if (!allocatedResource) {
      return;
    }

    setResources((prev) => {
      if (prev.some((r) => r.id === allocatedResource.id)) {
        return prev;
      }
      return [...prev, allocatedResource];
    });
  }

  function handleSelectSlot(slot) {
    addAllocatedResource(slot.allocatedResource);

    setFormData((currentData) => ({
      ...currentData,
      startAt: toDateTimeLocalValue(slot.startAt, userTimezone),
      endAt: toDateTimeLocalValue(slot.endAt, userTimezone),
      resourceId:
        slot.allocatedResource?.id ||
        slotSearchData.resourceId ||
        currentData.resourceId,
      attendeeCount: slotSearchData.attendeeCount || currentData.attendeeCount,
    }));
    setConflictWarning([]);
    setStatusMessage(
      `Selected slot: ${formatTime(slot.startAt)} – ${formatTime(slot.endAt)}${
        slot.allocatedResource ? ` (Allocated: ${slot.allocatedResource.name})` : ""
      }`,
    );
  }

  function handleSelectSuggestion(suggestion) {
    addAllocatedResource(suggestion.allocatedResource);

    setFormData((prev) => ({
      ...prev,
      startAt: toDateTimeLocalValue(suggestion.startAt, userTimezone),
      endAt: toDateTimeLocalValue(suggestion.endAt, userTimezone),
      resourceId:
        suggestion.allocatedResource?.id ||
        slotSearchData.resourceId ||
        prev.resourceId,
      attendeeCount: slotSearchData.attendeeCount || prev.attendeeCount,
    }));
    setConflictWarning([]);
    if (suggestion.allocatedResource) {
      setStatusMessage(
        `Selected suggestion: ${formatTime(suggestion.startAt)} – ${formatTime(suggestion.endAt)} (Allocated: ${suggestion.allocatedResource.name})`,
      );
    }
  }

  function buildPreferences(data = slotSearchData) {
    const preferences = {};

    if (
      data.preferredStartHour !== "" &&
      data.preferredStartHour !== null
    ) {
      preferences.preferredStartHour = Number(data.preferredStartHour);
    }
    if (
      data.preferredEndHour !== "" &&
      data.preferredEndHour !== null
    ) {
      preferences.preferredEndHour = Number(data.preferredEndHour);
    }
    if (data.avoidEarlyMorning) {
      preferences.avoidEarlyMorning = true;
    }
    if (data.avoidLateDay) {
      preferences.avoidLateDay = true;
    }
    if (data.earliestSlotBonus) {
      preferences.earliestSlotBonus = true;
    }
    preferences.timezone = userTimezone;

    return preferences;
  }

  function collectSearchParticipantEmails(
    data = slotSearchData,
    people = pickedParticipants,
    typedQuery = participantSearchQuery,
  ) {
    const emailsFromPicked = people.map((p) => p.email).filter(Boolean);
    const emailsFromQuery = parseParticipantEmails(typedQuery || data.participantEmails);

    return Array.from(new Set([...emailsFromPicked, ...emailsFromQuery]));
  }

  function buildResourceRequest(data = slotSearchData) {
    return {
      resourceId: data.resourceId || undefined,
      attendeeCount: data.attendeeCount
        ? Number(data.attendeeCount)
        : undefined,
      autoAllocateResource: data.autoAllocateResource || undefined,
      resourceType:
        data.autoAllocateResource && data.resourceType
          ? data.resourceType
          : undefined,
    };
  }

  async function handleFindSlots(event) {
    event?.preventDefault?.();
    setSlotSearchError("");

    if (slotSearchData.autoAllocateResource && slotSearchData.resourceId) {
      setSlotSearchError(
        "Cannot specify both a manual resource and automatic resource allocation",
      );
      return;
    }

    setIsSearchingSlots(true);

    try {
      const result = await findAvailableSlots({
        windowStart: toIsoDate(slotSearchData.windowStart, userTimezone),
        windowEnd: toIsoDate(slotSearchData.windowEnd, userTimezone),
        durationMinutes: Number(slotSearchData.durationMinutes),
        slotStepMinutes: slotSearchData.slotStepMinutes
          ? Number(slotSearchData.slotStepMinutes)
          : undefined,
        preferences: buildPreferences(),
        participantEmails: collectSearchParticipantEmails(),
        ...buildResourceRequest(),
      });

      setAvailableSlots(result.slots);
      setSelectedParticipants(result.participants || []);
      setSelectedSlotResource(result.resource || null);
      setHasSearchedSlots(true);
      setAvailabilityStale(false);
    } catch (searchError) {
      setSlotSearchError(searchError.message);
    } finally {
      setIsSearchingSlots(false);
    }
  }

  // `overrides` lets the assistant search with values it just filled in,
  // before React has re-rendered with the new state.
  async function handleFindSuggestions(event, overrides = {}) {
    if (event?.preventDefault) {
      event.preventDefault();
    }

    const data = overrides.searchData || slotSearchData;
    const people = overrides.participants || pickedParticipants;
    const typedQuery = overrides.participants ? "" : participantSearchQuery;

    setSlotSearchError("");
    setSuggestionError("");

    if (data.autoAllocateResource && data.resourceId) {
      setSuggestionError(
        "Cannot specify both a manual resource and automatic resource allocation",
      );
      return;
    }

    setIsSearchingSuggestions(true);

    try {
      const result = await findSmartSuggestions({
        windowStart: toIsoDate(data.windowStart, userTimezone),
        windowEnd: toIsoDate(data.windowEnd, userTimezone),
        durationMinutes: Number(data.durationMinutes),
        slotStepMinutes: data.slotStepMinutes ? Number(data.slotStepMinutes) : 30,
        preferences: buildPreferences(data),
        minimumScore: data.minimumScore !== "" ? Number(data.minimumScore) : 0,
        maxSuggestions: data.maxSuggestions ? Number(data.maxSuggestions) : 3,
        participantEmails: collectSearchParticipantEmails(data, people, typedQuery),
        ...buildResourceRequest(data),
      });

      setSmartSuggestions(result.suggestions || []);
      setSelectedParticipants(result.participants || []);
      setSelectedSlotResource(result.resource || null);
      setSuggestionMeta({
        relaxed: result.relaxed,
        relaxationLevel: result.relaxationLevel,
        relaxationSteps: result.relaxationSteps || [],
      });
      setHasSearchedSuggestions(true);
      setAvailabilityStale(false);
    } catch (err) {
      setSuggestionError(err.message);
    } finally {
      setIsSearchingSuggestions(false);
    }
  }

  /** Returns true when the event was saved. */
  async function handleSubmitEvent(event) {
    event?.preventDefault?.();
    setError("");
    setConflictWarning([]);
    setIsSaving(true);

    const proposedStartAt = toIsoDate(formData.startAt, userTimezone);
    const proposedEndAt = toIsoDate(formData.endAt, userTimezone);

    try {
      const { hasConflict, conflicts } = await checkEventConflicts({
        startAt: proposedStartAt,
        endAt: proposedEndAt,
        excludeEventId: isEditing ? editingEventId : undefined,
      });

      if (hasConflict) {
        setConflictWarning(conflicts);
        return false;
      }

      const payload = {
        title: formData.title,
        description: formData.description,
        startAt: proposedStartAt,
        endAt: proposedEndAt,
        timezone: formData.timezone || userTimezone,
        location: formData.location,
        resourceId: formData.resourceId || null,
        attendeeCount: formData.attendeeCount
          ? Number(formData.attendeeCount)
          : undefined,
      };

      if (isEditing) {
        const updatedEvent = await updateEvent(editingEventId, payload);

        setEvents((currentEvents) =>
          sortEventsByStartAt(
            currentEvents.map((eventItem) =>
              eventItem.id === updatedEvent.id ? updatedEvent : eventItem,
            ),
          ),
        );
        setStatusMessage("Event updated successfully");
      } else {
        const createdEvent = await createEvent(payload);

        // Upsert: the real-time "event:created" push may already have added it.
        setEvents((currentEvents) =>
          sortEventsByStartAt(upsertById(currentEvents, createdEvent)),
        );
        setStatusMessage("Event created successfully");
      }

      resetForm();
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteEvent(eventId) {
    setError("");

    try {
      await deleteEvent(eventId);
      setEvents((currentEvents) =>
        currentEvents.filter((event) => event.id !== eventId),
      );

      if (editingEventId === eventId) {
        resetForm();
      }

      setStatusMessage("Event deleted successfully");
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  /** Returns true when the shared meeting was confirmed. */
  async function handleConfirmSharedMeeting() {
    setError("");
    setConflictWarning([]);
    setIsConfirmingMeeting(true);

    const proposedStartAt = toIsoDate(formData.startAt, userTimezone);
    const proposedEndAt = toIsoDate(formData.endAt, userTimezone);

    const participantEmails = Array.from(
      new Set(pickedParticipants.map((p) => p.email).filter(Boolean)),
    );

    try {
      const meeting = await confirmSharedMeeting({
        title: formData.title || "Shared Meeting",
        description: formData.description,
        startAt: proposedStartAt,
        endAt: proposedEndAt,
        timezone: formData.timezone || userTimezone,
        location: formData.location,
        participantEmails,
        resourceId: formData.resourceId || undefined,
        attendeeCount: formData.attendeeCount ? Number(formData.attendeeCount) : undefined,
      });

      // Upsert: the real-time "meeting:confirmed" push may already have added it.
      setEvents((currentEvents) => sortEventsByStartAt(upsertById(currentEvents, meeting)));
      setStatusMessage("Shared meeting confirmed successfully!");
      resetForm();
      setPickedParticipants([]);
      await loadInvitations();
      return true;
    } catch (confirmError) {
      setError(confirmError.message);
      return false;
    } finally {
      setIsConfirmingMeeting(false);
    }
  }

  async function handleRespondInvitation(meetingId, action) {
    setInvitationError("");
    setInvitationMessage("");
    setError("");

    try {
      await respondToInvitation(meetingId, action);
      await loadInvitations();
      await loadEvents();
      setInvitationMessage(`Invitation ${action} successfully`);
    } catch (err) {
      setInvitationError(err.message);
    }
  }

  async function handleCancelMeeting(meetingId) {
    setError("");

    try {
      await cancelMeeting(meetingId);
      setEvents((currentEvents) =>
        currentEvents.map((evt) =>
          evt.id === meetingId ? { ...evt, status: "cancelled" } : evt,
        ),
      );
      setStatusMessage("Meeting cancelled successfully");
    } catch (err) {
      setError(err.message);
    }
  }

  function handleResourceFormChange(event) {
    const { name, value, type } = event.target;
    setResourceError("");
    setResourceFormData((prev) => ({
      ...prev,
      [name]: type === "number" ? (value === "" ? "" : Number(value)) : value,
    }));
  }

  function resetResourceForm() {
    setResourceFormData(initialResourceFormData);
    setEditingResourceId(null);
    setResourceError("");
  }

  function handleEditResource(resource) {
    setEditingResourceId(resource.id);
    setResourceFormData({
      name: resource.name,
      type: resource.type,
      capacity: resource.capacity,
      location: resource.location || "",
      description: resource.description || "",
    });
    setResourceError("");
  }

  async function handleSubmitResource(event) {
    event.preventDefault();
    setResourceError("");
    setIsSavingResource(true);

    try {
      const payload = {
        ...resourceFormData,
        capacity: Number(resourceFormData.capacity),
      };

      if (editingResourceId) {
        const updated = await updateResource(editingResourceId, payload);
        setResources((prev) =>
          prev.map((r) => (r.id === updated.id ? updated : r)),
        );
      } else {
        const created = await createResource(payload);
        // Upsert: the real-time "resource:created" push may already have added it.
        setResources((prev) => upsertById(prev, created));
      }
      resetResourceForm();
    } catch (err) {
      setResourceError(err.message);
    } finally {
      setIsSavingResource(false);
    }
  }

  async function handleDeactivateResource(resourceId) {
    setResourceError("");
    try {
      await deleteResource(resourceId);
      setResources((prev) => prev.filter((r) => r.id !== resourceId));
      if (editingResourceId === resourceId) {
        resetResourceForm();
      }
      if (formData.resourceId === resourceId) {
        setFormData((prev) => ({ ...prev, resourceId: "" }));
      }
      if (slotSearchData.resourceId === resourceId) {
        setSlotSearchData((prev) => ({ ...prev, resourceId: "" }));
      }
    } catch (err) {
      setResourceError(err.message);
    }
  }

  /**
   * Fills Find a time (and the composer's title) from a draft parsed by the
   * scheduling assistant. With `search: true` it also runs smart
   * suggestions on exactly those values.
   */
  function handleApplyAssistantRequest(draft, participants = [], { search = false } = {}) {
    const searchData = {
      ...slotSearchData,
      windowStart: toDateTimeLocalValue(draft.windowStart, userTimezone),
      windowEnd: toDateTimeLocalValue(draft.windowEnd, userTimezone),
      durationMinutes: draft.durationMinutes,
      preferredStartHour: draft.preferences?.preferredStartHour ?? "",
      preferredEndHour: draft.preferences?.preferredEndHour ?? "",
      avoidEarlyMorning: Boolean(draft.preferences?.avoidEarlyMorning),
      avoidLateDay: Boolean(draft.preferences?.avoidLateDay),
      autoAllocateResource: Boolean(draft.resource?.type),
      resourceType: draft.resource?.type || "",
      resourceId: draft.resource?.type ? "" : slotSearchData.resourceId,
      attendeeCount: draft.resource?.attendeeCount
        ? String(draft.resource.attendeeCount)
        : slotSearchData.attendeeCount,
    };

    setSlotSearchData(searchData);
    setPickedParticipants(participants);
    setParticipantSearchQuery("");
    setFormData((prev) => ({ ...prev, title: draft.title }));
    setStatusMessage(`Filled in “${draft.title}” from your description`);

    if (search) {
      return handleFindSuggestions(undefined, { searchData, participants });
    }

    return undefined;
  }

  async function handleMarkNotificationRead(notificationId) {
    const target = notifications.find((item) => item.id === notificationId);

    if (!target || target.read) {
      return;
    }

    // Optimistic: the item looks read at once; the server count follows.
    setNotifications((current) =>
      current.map((item) => (item.id === notificationId ? { ...item, read: true } : item)),
    );
    setUnreadCount((count) => Math.max(0, count - 1));

    try {
      const result = await markNotificationRead(notificationId);
      setUnreadCount(result.unreadCount);
      setNotificationError("");
    } catch (err) {
      setNotificationError(err.message);
      loadNotifications();
    }
  }

  async function handleMarkAllNotificationsRead() {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);

    try {
      const result = await markAllNotificationsRead();
      setUnreadCount(result.unreadCount);
      setNotificationError("");
    } catch (err) {
      setNotificationError(err.message);
      loadNotifications();
    }
  }

  async function handleUpdateReminderPreference(minutes) {
    try {
      const preferences = await updateNotificationPreferences({
        reminderMinutesBefore: Number(minutes),
      });
      setNotificationPreferences(preferences);
      setNotificationError("");
    } catch (err) {
      setNotificationError(err.message);
    }
  }

  function handleRefreshAvailability() {
    if (hasSearchedSlots) {
      handleFindSlots();
    }

    if (hasSearchedSuggestions) {
      handleFindSuggestions();
    }
  }

  const value = {
    user,
    userTimezone,
    formatTime,

    realtimeStatus,
    availabilityStale: availabilityStale && (hasSearchedSlots || hasSearchedSuggestions),
    handleRefreshAvailability,

    events,
    statusMessage,
    error,

    formData,
    isEditing,
    editingEventId,
    isSaving,
    conflictWarning,
    handleChange,
    resetForm,
    handleEditEvent,
    handleSubmitEvent,
    handleDeleteEvent,
    handleConfirmSharedMeeting,
    isConfirmingMeeting,
    handleCancelMeeting,

    slotSearchData,
    handleSlotSearchChange,
    handleAutoAllocateChange,
    handleFindSlots,
    handleFindSuggestions,
    availableSlots,
    hasSearchedSlots,
    isSearchingSlots,
    slotSearchError,
    smartSuggestions,
    suggestionMeta,
    hasSearchedSuggestions,
    isSearchingSuggestions,
    suggestionError,
    handleSelectSlot,
    handleSelectSuggestion,
    selectedParticipants,
    pickedParticipants,
    setPickedParticipants,
    participantSearchQuery,
    setParticipantSearchQuery,
    selectedSlotResource,

    resources,
    resourceFormData,
    editingResourceId,
    resourceError,
    isSavingResource,
    handleResourceFormChange,
    resetResourceForm,
    handleEditResource,
    handleSubmitResource,
    handleDeactivateResource,

    invitations,
    invitationMessage,
    invitationError,
    handleRespondInvitation,

    assistantStatus,
    handleApplyAssistantRequest,

    notifications,
    unreadCount,
    notificationPreferences,
    notificationError,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    handleUpdateReminderPreference,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export default DashboardProvider;
