import { useEffect, useState } from "react";
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

  const isEditing = Boolean(editingEventId);

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
    },
    onResync: () => {
      loadEvents();
      loadInvitations();
      loadResources();
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

  function buildPreferences() {
    const preferences = {};

    if (
      slotSearchData.preferredStartHour !== "" &&
      slotSearchData.preferredStartHour !== null
    ) {
      preferences.preferredStartHour = Number(slotSearchData.preferredStartHour);
    }
    if (
      slotSearchData.preferredEndHour !== "" &&
      slotSearchData.preferredEndHour !== null
    ) {
      preferences.preferredEndHour = Number(slotSearchData.preferredEndHour);
    }
    if (slotSearchData.avoidEarlyMorning) {
      preferences.avoidEarlyMorning = true;
    }
    if (slotSearchData.avoidLateDay) {
      preferences.avoidLateDay = true;
    }
    if (slotSearchData.earliestSlotBonus) {
      preferences.earliestSlotBonus = true;
    }
    preferences.timezone = userTimezone;

    return preferences;
  }

  function collectSearchParticipantEmails() {
    const emailsFromPicked = pickedParticipants.map((p) => p.email).filter(Boolean);
    const emailsFromQuery = parseParticipantEmails(
      participantSearchQuery || slotSearchData.participantEmails,
    );

    return Array.from(new Set([...emailsFromPicked, ...emailsFromQuery]));
  }

  function buildResourceRequest() {
    return {
      resourceId: slotSearchData.resourceId || undefined,
      attendeeCount: slotSearchData.attendeeCount
        ? Number(slotSearchData.attendeeCount)
        : undefined,
      autoAllocateResource: slotSearchData.autoAllocateResource || undefined,
      resourceType:
        slotSearchData.autoAllocateResource && slotSearchData.resourceType
          ? slotSearchData.resourceType
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

  async function handleFindSuggestions(event) {
    if (event?.preventDefault) {
      event.preventDefault();
    }

    setSlotSearchError("");
    setSuggestionError("");

    if (slotSearchData.autoAllocateResource && slotSearchData.resourceId) {
      setSuggestionError(
        "Cannot specify both a manual resource and automatic resource allocation",
      );
      return;
    }

    setIsSearchingSuggestions(true);

    try {
      const result = await findSmartSuggestions({
        windowStart: toIsoDate(slotSearchData.windowStart, userTimezone),
        windowEnd: toIsoDate(slotSearchData.windowEnd, userTimezone),
        durationMinutes: Number(slotSearchData.durationMinutes),
        slotStepMinutes: slotSearchData.slotStepMinutes
          ? Number(slotSearchData.slotStepMinutes)
          : 30,
        preferences: buildPreferences(),
        minimumScore:
          slotSearchData.minimumScore !== ""
            ? Number(slotSearchData.minimumScore)
            : 0,
        maxSuggestions: slotSearchData.maxSuggestions
          ? Number(slotSearchData.maxSuggestions)
          : 3,
        participantEmails: collectSearchParticipantEmails(),
        ...buildResourceRequest(),
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
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export default DashboardProvider;
