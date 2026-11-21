import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ParticipantPicker from "../components/ParticipantPicker";
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
    participantEmail: "",
    participantName: "",
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

function buildParticipants(formData) {
  if (!formData.participantEmail.trim()) {
    return [];
  }

  return [
    {
      email: formData.participantEmail,
      name: formData.participantName,
    },
  ];
}

function getFormDataFromEvent(event, userTimezone = "UTC") {
  const firstParticipant = event.participants?.[0];

  return {
    title: event.title || "",
    description: event.description || "",
    startAt: toDateTimeLocalValue(event.startAt, userTimezone),
    endAt: toDateTimeLocalValue(event.endAt, userTimezone),
    timezone: event.timezone || userTimezone,
    location: event.location || "",
    participantEmail: firstParticipant?.email || "",
    participantName: firstParticipant?.name || "",
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

function DashboardPage() {
  const { user } = useAuth();
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

  const isEditing = Boolean(editingEventId);

  function formatTime(isoDate) {
    return formatEventTime(isoDate, userTimezone);
  }

  async function loadEvents() {
    try {
      const loadedEvents = await listEvents();

      setEvents(loadedEvents);
      setStatusMessage(
        loadedEvents.length ? `${loadedEvents.length} event(s) loaded` : "No events yet",
      );
    } catch (loadError) {
      setError(loadError.message);
      setStatusMessage("Unable to load events");
    }
  }

  async function loadResources() {
    try {
      const loadedResources = await listResources();
      setResources(loadedResources);
    } catch (loadError) {
      // non-fatal
    }
  }

  async function loadInvitations() {
    try {
      const loadedInvitations = await listInvitations();
      setInvitations(loadedInvitations || []);
    } catch (loadError) {
      // non-fatal
    }
  }

  useEffect(() => {
    loadEvents();
    loadResources();
    loadInvitations();
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

  function handleSelectSlot(slot) {
    if (slot.allocatedResource) {
      setResources((prev) => {
        if (prev.some((r) => r.id === slot.allocatedResource.id)) {
          return prev;
        }
        return [...prev, slot.allocatedResource];
      });
    }

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

  async function handleFindSlots(event) {
    event.preventDefault();
    setSlotSearchError("");

    if (slotSearchData.autoAllocateResource && slotSearchData.resourceId) {
      setSlotSearchError(
        "Cannot specify both a manual resource and automatic resource allocation",
      );
      return;
    }

    setIsSearchingSlots(true);

    try {
      const preferences = {
        timezone: userTimezone,
      };
      if (slotSearchData.preferredStartHour !== "") {
        preferences.preferredStartHour = Number(
          slotSearchData.preferredStartHour,
        );
      }
      if (slotSearchData.preferredEndHour !== "") {
        preferences.preferredEndHour = Number(
          slotSearchData.preferredEndHour,
        );
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

      const emailsFromPicked = pickedParticipants
        .map((p) => p.email)
        .filter(Boolean);
      const emailsFromQuery = parseParticipantEmails(
        participantSearchQuery || slotSearchData.participantEmails,
      );
      const participantEmails = Array.from(
        new Set([...emailsFromPicked, ...emailsFromQuery]),
      );

      const result = await findAvailableSlots({
        windowStart: toIsoDate(slotSearchData.windowStart, userTimezone),
        windowEnd: toIsoDate(slotSearchData.windowEnd, userTimezone),
        durationMinutes: Number(slotSearchData.durationMinutes),
        slotStepMinutes: slotSearchData.slotStepMinutes
          ? Number(slotSearchData.slotStepMinutes)
          : undefined,
        preferences,
        participantEmails,
        resourceId: slotSearchData.resourceId || undefined,
        attendeeCount: slotSearchData.attendeeCount
          ? Number(slotSearchData.attendeeCount)
          : undefined,
        autoAllocateResource: slotSearchData.autoAllocateResource || undefined,
        resourceType:
          slotSearchData.autoAllocateResource && slotSearchData.resourceType
            ? slotSearchData.resourceType
            : undefined,
      });

      setAvailableSlots(result.slots);
      setSelectedParticipants(result.participants || []);
      setSelectedSlotResource(result.resource || null);
      setHasSearchedSlots(true);
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
      const windowStartIso = toIsoDate(
        slotSearchData.windowStart,
        userTimezone,
      );
      const windowEndIso = toIsoDate(
        slotSearchData.windowEnd,
        userTimezone,
      );

      const preferences = {};
      if (
        slotSearchData.preferredStartHour !== "" &&
        slotSearchData.preferredStartHour !== null
      ) {
        preferences.preferredStartHour = Number(
          slotSearchData.preferredStartHour,
        );
      }
      if (
        slotSearchData.preferredEndHour !== "" &&
        slotSearchData.preferredEndHour !== null
      ) {
        preferences.preferredEndHour = Number(
          slotSearchData.preferredEndHour,
        );
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

      const emailsFromPicked = pickedParticipants
        .map((p) => p.email)
        .filter(Boolean);
      const emailsFromQuery = parseParticipantEmails(
        participantSearchQuery || slotSearchData.participantEmails,
      );
      const participantEmails = Array.from(
        new Set([...emailsFromPicked, ...emailsFromQuery]),
      );

      const result = await findSmartSuggestions({
        windowStart: windowStartIso,
        windowEnd: windowEndIso,
        durationMinutes: Number(slotSearchData.durationMinutes),
        slotStepMinutes: slotSearchData.slotStepMinutes
          ? Number(slotSearchData.slotStepMinutes)
          : 30,
        preferences,
        minimumScore:
          slotSearchData.minimumScore !== ""
            ? Number(slotSearchData.minimumScore)
            : 0,
        maxSuggestions: slotSearchData.maxSuggestions
          ? Number(slotSearchData.maxSuggestions)
          : 3,
        participantEmails,
        resourceId: slotSearchData.resourceId || undefined,
        attendeeCount: slotSearchData.attendeeCount
          ? Number(slotSearchData.attendeeCount)
          : undefined,
        autoAllocateResource: slotSearchData.autoAllocateResource || undefined,
        resourceType:
          slotSearchData.autoAllocateResource && slotSearchData.resourceType
            ? slotSearchData.resourceType
            : undefined,
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
    } catch (err) {
      setSuggestionError(err.message);
    } finally {
      setIsSearchingSuggestions(false);
    }
  }

  function handleSelectSuggestion(suggestion) {
    if (suggestion.allocatedResource) {
      setResources((prev) => {
        if (prev.some((r) => r.id === suggestion.allocatedResource.id)) {
          return prev;
        }
        return [...prev, suggestion.allocatedResource];
      });
    }

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

  async function handleSubmitEvent(event) {
    event.preventDefault();
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
        setIsSaving(false);
        return;
      }

      const payload = {
        title: formData.title,
        description: formData.description,
        startAt: proposedStartAt,
        endAt: proposedEndAt,
        timezone: formData.timezone || userTimezone,
        location: formData.location,
        participants: buildParticipants(formData),
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

        setEvents((currentEvents) =>
          sortEventsByStartAt([...currentEvents, createdEvent]),
        );
        setStatusMessage("Event created successfully");
      }

      resetForm();
    } catch (saveError) {
      setError(saveError.message);
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

  async function handleConfirmSharedMeeting() {
    setError("");
    setConflictWarning([]);
    setIsConfirmingMeeting(true);

    const proposedStartAt = toIsoDate(formData.startAt, userTimezone);
    const proposedEndAt = toIsoDate(formData.endAt, userTimezone);

    const emailsFromPicked = pickedParticipants.map((p) => p.email).filter(Boolean);
    const emailsFromInput = parseParticipantEmails(formData.participantEmail);
    const participantEmails = Array.from(new Set([...emailsFromPicked, ...emailsFromInput]));

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

      setEvents((currentEvents) => sortEventsByStartAt([...currentEvents, meeting]));
      setStatusMessage("Shared meeting confirmed successfully!");
      resetForm();
      setPickedParticipants([]);
      await loadInvitations();
    } catch (confirmError) {
      setError(confirmError.message);
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
        setResources((prev) => [...prev, created]);
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

  return (
    <main className="app dashboard-layout">
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Welcome, {user.name}</h1>
          <p className="description">
            Create, edit, and manage your events. Conflict detection is active —
            overlapping events will be flagged before saving.
          </p>
        </div>

        <Link className="secondary-button" to="/">
          Back home
        </Link>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-left-column">
          <form className="panel event-form" onSubmit={handleSubmitEvent}>
            <div>
              <p className="eyebrow">{isEditing ? "Edit event" : "New event"}</p>
              <h2>{isEditing ? "Update calendar event" : "Create calendar event"}</h2>
            </div>

            <label>
              Title
              <input
                name="title"
                type="text"
                value={formData.title}
                onChange={handleChange}
                placeholder="Planning meeting"
                required
              />
            </label>

            <label>
              Description
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="What is this event about?"
              />
            </label>

            <div className="form-row">
              <label>
                Starts
                <input
                  name="startAt"
                  type="datetime-local"
                  value={formData.startAt}
                  onChange={handleChange}
                  required
                />
              </label>

              <label>
                Ends
                <input
                  name="endAt"
                  type="datetime-local"
                  value={formData.endAt}
                  onChange={handleChange}
                  required
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                Timezone
                <input
                  name="timezone"
                  type="text"
                  value={formData.timezone}
                  onChange={handleChange}
                  required
                />
              </label>

              <label>
                Location
                <input
                  name="location"
                  type="text"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="Room 301"
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                Participant email
                <input
                  name="participantEmail"
                  type="email"
                  value={formData.participantEmail}
                  onChange={handleChange}
                  placeholder="alex@example.com"
                />
              </label>

              <label>
                Participant name
                <input
                  name="participantName"
                  type="text"
                  value={formData.participantName}
                  onChange={handleChange}
                  placeholder="Alex"
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                Book resource
                <select
                  role="listbox"
                  name="resourceId"
                  value={formData.resourceId}
                  onChange={handleChange}
                >
                  <option value="">None</option>
                  {resources.map((res) => (
                    <option key={res.id} value={res.id}>
                      {res.name} ({res.type}, cap: {res.capacity})
                    </option>
                  ))}
                  {formData.resourceId &&
                  !resources.some((res) => res.id === formData.resourceId) ? (
                    <option value={formData.resourceId}>
                      {formData.resourceId}
                    </option>
                  ) : null}
                </select>
              </label>

              <label>
                Expected attendees
                <input
                  name="attendeeCount"
                  type="number"
                  min="1"
                  value={formData.attendeeCount}
                  onChange={handleChange}
                  placeholder="e.g. 5"
                />
              </label>
            </div>

            {conflictWarning.length > 0 ? (
              <div
                className="conflict-warning"
                role="alert"
                aria-label="Conflict warning"
              >
                <p className="conflict-warning-title">
                  ⚠ Scheduling conflict detected
                </p>
                <p className="conflict-warning-subtitle">
                  This time overlaps with{" "}
                  {conflictWarning.length === 1
                    ? "an existing event"
                    : "existing events"}
                  . Change the start or end time and try again.
                </p>
                <ul className="conflict-list">
                  {conflictWarning.map((conflict) => (
                    <li key={conflict.id} className="conflict-item">
                      <span className="conflict-item-title">{conflict.title}</span>
                      <span className="conflict-item-time">
                        {formatTime(conflict.startAt)} –{" "}
                        {formatTime(conflict.endAt)}
                      </span>
                      {conflict.location ? (
                        <span className="conflict-item-location">
                          {conflict.location}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? (
              <p className="form-error">
                {error.includes("replica set")
                  ? "⚠ Atomic scheduling requires a MongoDB replica set. Please configure a replica set on your MongoDB server to enable atomic confirmation."
                  : error}
              </p>
            ) : null}

            <div className="button-row">
              <button className="primary-link" type="submit" disabled={isSaving}>
                {isSaving
                  ? "Checking conflicts..."
                  : isEditing
                    ? "Update event"
                    : "Create event"}
              </button>

              {!isEditing && (pickedParticipants.length > 0 || formData.participantEmail.trim()) ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isConfirmingMeeting}
                  onClick={handleConfirmSharedMeeting}
                >
                  {isConfirmingMeeting ? "Confirming..." : "Confirm shared meeting"}
                </button>
              ) : null}

              {isEditing ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          <section className="panel slot-finder-panel">
            <div>
              <p className="eyebrow">Available Slot Finder</p>
              <h2>Find available slots</h2>
              <p className="description">
                Search for conflict-free time slots ranked best-first by preferences.
                Click a slot to fill the event form.
              </p>
            </div>

            <form className="slot-finder-form" onSubmit={handleFindSlots}>
              <div className="form-row">
                <label>
                  Window start
                  <input
                    name="windowStart"
                    type="datetime-local"
                    value={slotSearchData.windowStart}
                    onChange={handleSlotSearchChange}
                    required
                  />
                </label>

                <label>
                  Window end
                  <input
                    name="windowEnd"
                    type="datetime-local"
                    value={slotSearchData.windowEnd}
                    onChange={handleSlotSearchChange}
                    required
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Duration (minutes)
                  <input
                    name="durationMinutes"
                    type="number"
                    min="1"
                    value={slotSearchData.durationMinutes}
                    onChange={handleSlotSearchChange}
                    required
                  />
                </label>

                <label>
                  Step (minutes)
                  <input
                    name="slotStepMinutes"
                    type="number"
                    min="1"
                    value={slotSearchData.slotStepMinutes}
                    onChange={handleSlotSearchChange}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Required resource (Optional)
                  <select
                    role="listbox"
                    name="resourceId"
                    value={slotSearchData.resourceId}
                    onChange={handleSlotSearchChange}
                    disabled={slotSearchData.autoAllocateResource}
                  >
                    <option value="">None</option>
                    {resources.map((res) => (
                      <option key={res.id} value={res.id}>
                        {res.name} ({res.type}, cap: {res.capacity})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Required attendees
                  <input
                    name="attendeeCount"
                    type="number"
                    min="1"
                    value={slotSearchData.attendeeCount}
                    onChange={handleSlotSearchChange}
                    placeholder="e.g. 4"
                  />
                </label>
              </div>

              <div className="auto-allocate-group">
                <label className="checkbox-label">
                  <input
                    name="autoAllocateResource"
                    type="checkbox"
                    checked={slotSearchData.autoAllocateResource}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSlotSearchData((prev) => ({
                        ...prev,
                        autoAllocateResource: checked,
                        resourceId: checked ? "" : prev.resourceId,
                      }));
                    }}
                  />
                  Automatically allocate a resource
                </label>

                {slotSearchData.autoAllocateResource ? (
                  <label className="resource-type-select">
                    Resource type preference
                    <select
                      name="resourceType"
                      value={slotSearchData.resourceType}
                      onChange={handleSlotSearchChange}
                    >
                      <option value="">Any type</option>
                      <option value="room">Room</option>
                      <option value="equipment">Equipment</option>
                    </select>
                  </label>
                ) : null}
              </div>

              <ParticipantPicker
                selectedParticipants={pickedParticipants}
                onParticipantsChange={setPickedParticipants}
                searchQuery={participantSearchQuery}
                onSearchQueryChange={setParticipantSearchQuery}
                organizer={user}
                disabled={isSearchingSlots || isSearchingSuggestions}
              />

              <fieldset className="preference-fieldset">
                <legend className="preference-legend">
                  Preferences &amp; Ranking (Optional)
                </legend>

                <div className="form-row">
                  <label>
                    Preferred start hour
                    <input
                      name="preferredStartHour"
                      type="number"
                      min="0"
                      max="23"
                      placeholder="e.g. 13"
                      value={slotSearchData.preferredStartHour}
                      onChange={handleSlotSearchChange}
                    />
                  </label>

                  <label>
                    Preferred end hour
                    <input
                      name="preferredEndHour"
                      type="number"
                      min="0"
                      max="23"
                      placeholder="e.g. 17"
                      value={slotSearchData.preferredEndHour}
                      onChange={handleSlotSearchChange}
                    />
                  </label>
                </div>

                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      name="avoidEarlyMorning"
                      type="checkbox"
                      checked={slotSearchData.avoidEarlyMorning}
                      onChange={handleSlotSearchChange}
                    />
                    Avoid early morning (&lt; 10:00 AM)
                  </label>

                  <label className="checkbox-label">
                    <input
                      name="avoidLateDay"
                      type="checkbox"
                      checked={slotSearchData.avoidLateDay}
                      onChange={handleSlotSearchChange}
                    />
                    Avoid late day (&gt; 5:00 PM)
                  </label>

                  <label className="checkbox-label">
                    <input
                      name="earliestSlotBonus"
                      type="checkbox"
                      checked={slotSearchData.earliestSlotBonus}
                      onChange={handleSlotSearchChange}
                    />
                    Earliest slot bonus
                  </label>
                </div>

                <div className="form-row">
                  <label>
                    Minimum score
                    <input
                      name="minimumScore"
                      type="number"
                      min="0"
                      max="100"
                      placeholder="e.g. 70"
                      value={slotSearchData.minimumScore}
                      onChange={handleSlotSearchChange}
                    />
                  </label>

                  <label>
                    Max suggestions
                    <input
                      name="maxSuggestions"
                      type="number"
                      min="1"
                      placeholder="3"
                      value={slotSearchData.maxSuggestions}
                      onChange={handleSlotSearchChange}
                    />
                  </label>
                </div>
              </fieldset>

              {slotSearchError ? (
                <p className="form-error">{slotSearchError}</p>
              ) : null}
              {suggestionError ? (
                <p className="form-error">{suggestionError}</p>
              ) : null}

              <div className="button-row">
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={isSearchingSlots}
                >
                  {isSearchingSlots
                    ? "Searching slots..."
                    : "Find available slots"}
                </button>

                <button
                  className="secondary-button"
                  type="button"
                  disabled={isSearchingSuggestions}
                  onClick={handleFindSuggestions}
                >
                  {isSearchingSuggestions
                    ? "Finding suggestions..."
                    : "Find smart suggestions"}
                </button>
              </div>
            </form>

            {selectedParticipants.length > 0 ? (
              <aside
                className="participant-summary"
                role="region"
                aria-label="Coordinated participants"
              >
                <div className="participant-summary-header">
                  <span className="participant-summary-title">Coordinated Participants</span>
                  <span className="participant-count-badge">
                    {selectedParticipants.length} user{selectedParticipants.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="participant-chips">
                  {selectedParticipants.map((p, pIndex) => (
                    <div key={p.id || p.email} className="participant-chip">
                      <span className="participant-name">
                        {p.name || p.email} {pIndex === 0 ? "(You)" : ""}
                      </span>
                      <span className="participant-email">{p.email}</span>
                      <span className="participant-tz">{p.timezone}</span>
                    </div>
                  ))}
                </div>
                <p className="participant-notice">
                  Availability discovery only. Selecting a slot sets the date and time in your event form. (Shared invitations are part of the confirmation phase).
                </p>
              </aside>
            ) : null}

            {selectedSlotResource ? (
              <div className="resource-summary-badge" role="region" aria-label="Selected slot resource">
                Resource: <strong>{selectedSlotResource.name}</strong> ({selectedSlotResource.type}, cap: {selectedSlotResource.capacity})
              </div>
            ) : null}

            {hasSearchedSlots ? (
              <div className="slot-results">
                <h3>Ranked Available Slots</h3>
                {availableSlots.length > 0 ? (
                  <div
                    className="slot-list"
                    role="region"
                    aria-label="Available slots"
                  >
                    {availableSlots.map((slot, index) => (
                      <button
                        key={`${slot.startAt}-${slot.endAt}-${index}`}
                        type="button"
                        className="slot-pill-button"
                        onClick={() => handleSelectSlot(slot)}
                        title="Click to use this time slot in the event form"
                      >
                        <div className="slot-pill-content">
                          <div className="slot-pill-header">
                            <span className="slot-pill-time">
                              {formatTime(slot.startAt)} –{" "}
                              {formatTime(slot.endAt)}
                            </span>
                            {typeof slot.score === "number" ? (
                              <span className="slot-score-badge">
                                Score: {slot.score}
                              </span>
                            ) : null}
                          </div>

                          {slot.reasons && slot.reasons.length > 0 ? (
                            <div className="slot-reasons">
                              {slot.reasons.map((reason, rIndex) => (
                                <span key={rIndex} className="slot-reason-tag">
                                  {reason}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          {slot.allocatedResource ? (
                            <div className="slot-allocated-resource">
                              <span className="slot-resource-badge">
                                Allocated: {slot.allocatedResource.name} ({slot.allocatedResource.type}, cap: {slot.allocatedResource.capacity})
                              </span>
                              {slot.allocationReason ? (
                                <span className="slot-allocation-reason">
                                  {slot.allocationReason}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <span className="slot-pill-action">Select</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="description empty-slots">
                    No available slots found
                  </p>
                )}
              </div>
            ) : null}

            {hasSearchedSuggestions ? (
              <div className="slot-results">
                <h3>Smart Suggestions</h3>
                {suggestionMeta?.relaxed ? (
                  <aside
                    className="relaxation-notice"
                    role="note"
                    aria-label="Relaxation notice"
                  >
                    <p>
                      <strong>No strict match found. Constraints relaxed:</strong>
                    </p>
                    <div className="relaxation-tags">
                      {suggestionMeta.relaxationSteps
                        ?.filter(
                          (step) =>
                            step.level > 0 &&
                            step.level <= suggestionMeta.relaxationLevel,
                        )
                        .map((step) => (
                          <span key={step.level} className="relaxation-chip">
                            {step.label}
                          </span>
                        ))}
                    </div>
                  </aside>
                ) : null}

                {smartSuggestions.length > 0 ? (
                  <div
                    className="slot-list"
                    role="region"
                    aria-label="Smart suggestions"
                  >
                    {smartSuggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion.startAt}-${suggestion.endAt}-${index}`}
                        type="button"
                        className="slot-pill-button suggestion-card"
                        onClick={() => handleSelectSuggestion(suggestion)}
                        title="Click to use this time slot in the event form"
                      >
                        <div className="slot-pill-content">
                          <div className="slot-pill-header">
                            <span className="slot-pill-time">
                              {formatTime(suggestion.startAt)} –{" "}
                              {formatTime(suggestion.endAt)}
                            </span>
                            {typeof suggestion.score === "number" ? (
                              <span className="slot-score-badge">
                                Score: {suggestion.score}
                              </span>
                            ) : null}
                          </div>

                          {suggestion.reasons && suggestion.reasons.length > 0 ? (
                            <div className="slot-reasons">
                              {suggestion.reasons.map((reason, rIndex) => (
                                <span key={rIndex} className="slot-reason-tag">
                                  {reason}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          {suggestion.relaxedConstraints &&
                          suggestion.relaxedConstraints.length > 0 ? (
                            <div className="slot-relaxed-constraints">
                              {suggestion.relaxedConstraints.map(
                                (constraint, cIndex) => (
                                  <span
                                    key={cIndex}
                                    className="slot-constraint-tag"
                                  >
                                    {constraint}
                                  </span>
                                ),
                              )}
                            </div>
                          ) : null}

                          {suggestion.allocatedResource ? (
                            <div className="slot-allocated-resource">
                              <span className="slot-resource-badge">
                                Allocated: {suggestion.allocatedResource.name} ({suggestion.allocatedResource.type}, cap: {suggestion.allocatedResource.capacity})
                              </span>
                              {suggestion.allocationReason ? (
                                <span className="slot-allocation-reason">
                                  {suggestion.allocationReason}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <span className="slot-pill-action">Select</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="description empty-slots">
                    No smart suggestions found
                  </p>
                )}
              </div>
            ) : null}
          </section>

          <section className="panel resource-panel">
            <div>
              <p className="eyebrow">Shared Resources</p>
              <h2>Rooms &amp; Equipment</h2>
              <p className="description">
                Manage shared resources. Check availability and prevent double bookings.
              </p>
            </div>

            <form className="resource-form" onSubmit={handleSubmitResource}>
              <div className="form-row">
                <label>
                  Resource name
                  <input
                    name="name"
                    type="text"
                    value={resourceFormData.name}
                    onChange={handleResourceFormChange}
                    placeholder="Boardroom A"
                    required
                  />
                </label>

                <label>
                  Type
                  <select
                    role="listbox"
                    name="type"
                    value={resourceFormData.type}
                    onChange={handleResourceFormChange}
                    required
                  >
                    <option value="room">Room</option>
                    <option value="equipment">Equipment</option>
                  </select>
                </label>
              </div>

              <div className="form-row">
                <label>
                  Capacity
                  <input
                    name="capacity"
                    type="number"
                    min="1"
                    value={resourceFormData.capacity}
                    onChange={handleResourceFormChange}
                    required
                  />
                </label>

                <label>
                  Resource venue
                  <input
                    name="location"
                    type="text"
                    value={resourceFormData.location}
                    onChange={handleResourceFormChange}
                    placeholder="Floor 3, East Wing"
                  />
                </label>
              </div>

              <label>
                Resource details
                <textarea
                  name="description"
                  value={resourceFormData.description}
                  onChange={handleResourceFormChange}
                  placeholder="Optional details or amenities"
                />
              </label>

              {resourceError ? <p className="form-error">{resourceError}</p> : null}

              <div className="button-row">
                <button
                  className="primary-link"
                  type="submit"
                  disabled={isSavingResource}
                >
                  {isSavingResource
                    ? "Saving..."
                    : editingResourceId
                      ? "Update resource"
                      : "Create resource"}
                </button>

                {editingResourceId ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={resetResourceForm}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>

            <div className="resource-list-section">
              <h3>Active Resources</h3>
              {resources.length ? (
                <div className="resource-cards">
                  {resources.map((res) => {
                    const isOwner = res.createdBy === user?.id;
                    return (
                      <div className="resource-card" key={res.id}>
                        <div className="resource-card-header">
                          <span className="resource-card-title">{res.name}</span>
                          <span className="resource-badge">{res.type}</span>
                        </div>
                        <div className="resource-meta">
                          <span>Capacity: {res.capacity}</span>
                          {res.location ? <span>• {res.location}</span> : null}
                        </div>
                        {res.description ? (
                          <p className="description">{res.description}</p>
                        ) : null}
                        {isOwner ? (
                          <div className="button-row">
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => handleEditResource(res)}
                            >
                              Edit
                            </button>
                            <button
                              className="secondary-button danger-button"
                              type="button"
                              onClick={() => handleDeactivateResource(res.id)}
                            >
                              Deactivate
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="description">No active resources yet.</p>
              )}
            </div>
          </section>
        </div>

        <section className="panel event-list">
          {invitations.length > 0 || invitationMessage || invitationError ? (
            <div className="invitations-section">
              <p className="eyebrow">Pending invitations</p>
              <h2>Meeting invitations ({invitations.length})</h2>
              {invitationMessage ? (
                <p className="status" style={{ marginBottom: "1rem" }}>
                  {invitationMessage}
                </p>
              ) : null}
              {invitationError ? (
                <p className="form-error" style={{ marginBottom: "1rem" }}>
                  {invitationError.includes("replica set")
                    ? "⚠ Atomic scheduling requires a MongoDB replica set. Please configure a replica set on your MongoDB server to enable atomic confirmation."
                    : invitationError}
                </p>
              ) : null}
              {invitations.length > 0 ? (
                <div
                  className="invitation-cards"
                  style={{ marginTop: "1rem", marginBottom: "2rem" }}
                >
                  {invitations.map((inv) => (
                  <article className="event-card invitation-card" key={inv.id}>
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <h3>{inv.title}</h3>
                        <span className="invitation-badge status-pending">
                          Pending
                        </span>
                      </div>
                      <p>{inv.description || "No description"}</p>
                    </div>

                    <dl>
                      <div>
                        <dt>Organizer</dt>
                        <dd>
                          {inv.organizer?.name
                            ? `${inv.organizer.name} (${inv.organizer.email})`
                            : inv.organizer?.email || "Unknown"}
                        </dd>
                      </div>
                      <div>
                        <dt>Starts</dt>
                        <dd>{formatTime(inv.startAt)}</dd>
                      </div>
                      <div>
                        <dt>Ends</dt>
                        <dd>{formatTime(inv.endAt)}</dd>
                      </div>
                      {inv.resourceDetails ? (
                        <div>
                          <dt>Resource</dt>
                          <dd>
                            <span className="resource-badge">
                              {inv.resourceDetails.name} ({inv.resourceDetails.type})
                            </span>
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <div className="button-row">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => handleRespondInvitation(inv.id, "accepted")}
                      >
                        Accept
                      </button>
                      <button
                        className="secondary-button danger-button"
                        type="button"
                        onClick={() => handleRespondInvitation(inv.id, "declined")}
                      >
                        Decline
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <p className="eyebrow">Your calendar</p>
            <h2>Events</h2>
            <p className="description">{statusMessage}</p>
          </div>

          {events.length ? (
            <div className="event-cards">
              {events.map((event) => {
                const isOwner =
                  !event.owner ||
                  event.owner === user?.id ||
                  (typeof event.owner === "object" && event.owner?._id === user?.id);
                const isCancelled = event.status === "cancelled";
                const myParticipant = event.participants?.find(
                  (p) =>
                    (p.user && p.user === user?.id) ||
                    (p.email &&
                      p.email.toLowerCase() === user?.email?.toLowerCase()),
                );

                return (
                  <article className="event-card" key={event.id}>
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <h3>{event.title}</h3>
                        {isCancelled ? (
                          <span className="meeting-status-badge cancelled">
                            Cancelled
                          </span>
                        ) : null}
                      </div>
                      <p>{event.description || "No description"}</p>
                    </div>

                    <dl>
                      <div>
                        <dt>Starts</dt>
                        <dd>{formatTime(event.startAt)}</dd>
                      </div>
                      <div>
                        <dt>Ends</dt>
                        <dd>{formatTime(event.endAt)}</dd>
                      </div>
                      <div>
                        <dt>Location</dt>
                        <dd>{event.location || "Not set"}</dd>
                      </div>
                      <div>
                        <dt>Resource</dt>
                        <dd>
                          {event.resourceDetails ? (
                            <span className="resource-badge">
                              {event.resourceDetails.name} ({event.resourceDetails.type})
                            </span>
                          ) : (
                            "None"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Participants</dt>
                        <dd>
                          {event.participants?.length
                            ? event.participants.map((participant, pIndex) => (
                              <span key={pIndex} className="participant-item">
                                <span>{participant.email}</span>
                                {participant.status ? (
                                  <span
                                    className={`invitation-badge status-${participant.status}`}
                                  >
                                    {participant.status}
                                  </span>
                                ) : null}
                                {pIndex < event.participants.length - 1 ? ", " : ""}
                              </span>
                            ))
                            : "None"}
                        </dd>
                      </div>
                    </dl>

                    <div className="button-row">
                      {isOwner ? (
                        <>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => handleEditEvent(event)}
                            disabled={isCancelled}
                          >
                            Edit
                          </button>

                          {!isCancelled && event.participants?.length > 0 ? (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => handleCancelMeeting(event.id)}
                            >
                              Cancel meeting
                            </button>
                          ) : null}

                          <button
                            className="secondary-button danger-button"
                            type="button"
                            onClick={() => handleDeleteEvent(event.id)}
                          >
                            Delete
                          </button>
                        </>
                      ) : myParticipant && !isCancelled ? (
                        <>
                          {myParticipant.status !== "accepted" ? (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() =>
                                handleRespondInvitation(event.id, "accepted")
                              }
                            >
                              Accept
                            </button>
                          ) : null}
                          {myParticipant.status !== "declined" ? (
                            <button
                              className="secondary-button danger-button"
                              type="button"
                              onClick={() =>
                                handleRespondInvitation(event.id, "declined")
                              }
                            >
                              Decline
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="description">
              No events yet. Create your first meeting on the left.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

export default DashboardPage;
