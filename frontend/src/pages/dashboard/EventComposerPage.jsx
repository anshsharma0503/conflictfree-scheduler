import { Link, useNavigate } from "react-router-dom";
import Icon from "../../components/Icon";
import ParticipantPicker from "../../components/ParticipantPicker";
import { useDashboard } from "../../hooks/useDashboard";

const REPLICA_SET_MESSAGE =
  "Atomic scheduling requires a MongoDB replica set. Please configure a replica set on your MongoDB server to enable atomic confirmation.";

function CheckItem({ state, title, detail }) {
  const iconClass =
    state === "ok" ? "check-icon is-ok" : state === "bad" ? "check-icon is-bad" : "check-icon";

  return (
    <div className="check-item">
      <span className={iconClass} aria-hidden="true">
        <Icon
          name={state === "bad" ? "alert" : state === "ok" ? "check" : "info"}
          size={12}
          strokeWidth={2.6}
        />
      </span>
      <div>
        <span>{title}</span>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function EventComposerPage() {
  const navigate = useNavigate();
  const {
    user,
    formatTime,
    formData,
    isEditing,
    isSaving,
    error,
    conflictWarning,
    handleChange,
    resetForm,
    handleSubmitEvent,
    handleConfirmSharedMeeting,
    isConfirmingMeeting,
    pickedParticipants,
    setPickedParticipants,
    participantSearchQuery,
    setParticipantSearchQuery,
    resources,
  } = useDashboard();

  const hasConflict = conflictWarning.length > 0;
  // With people picked, the event becomes a shared meeting: it is booked
  // through the confirm endpoint, which checks everyone atomically and sends
  // invitations. Personal events cannot carry participants.
  const isSharedMeeting = !isEditing && pickedParticipants.length > 0;
  const selectedResource = resources.find((res) => res.id === formData.resourceId);
  const attendeeCount = Number(formData.attendeeCount) || 0;
  const participantCount = pickedParticipants.length;

  async function onSubmit(event) {
    if (isSharedMeeting) {
      event.preventDefault();
      await onConfirmShared();
      return;
    }

    const saved = await handleSubmitEvent(event);

    if (saved) {
      navigate("/dashboard/events");
    }
  }

  async function onConfirmShared() {
    const confirmed = await handleConfirmSharedMeeting();

    if (confirmed) {
      navigate("/dashboard/events");
    }
  }

  function onCancelEdit() {
    resetForm();
    navigate("/dashboard/events");
  }

  let roomCheck = { state: "idle", title: "No room booked", detail: "Optional" };

  if (selectedResource) {
    const tooSmall = attendeeCount > 0 && attendeeCount > selectedResource.capacity;

    roomCheck = {
      state: tooSmall ? "bad" : "ok",
      title: selectedResource.name,
      detail: tooSmall
        ? `Seats ${selectedResource.capacity}, but ${attendeeCount} expected`
        : `Seats ${selectedResource.capacity} · availability checked on save`,
    };
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <span className="page-kicker">{isEditing ? "Edit event" : "New event"}</span>
          <h1>{isEditing ? "Update calendar event" : "Create calendar event"}</h1>
          <p>Conflicts with your calendar are checked before anything is saved.</p>
        </div>
      </div>

      <div className="split">
        <form className="panel split-main" style={{ gap: 0 }} onSubmit={onSubmit}>
          <div className="composer-head">
            <label className="field composer-title">
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
            <label className="field">
              Description
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="What is this event about?"
              />
            </label>
          </div>

          <div className="composer-group">
            <span className="composer-group-label">When</span>
            <div className="composer-group-body">
              <div className="field-row">
                <label className={hasConflict ? "field has-conflict" : "field"}>
                  Starts
                  <input
                    name="startAt"
                    type="datetime-local"
                    value={formData.startAt}
                    onChange={handleChange}
                    required
                  />
                </label>

                <label className={hasConflict ? "field has-conflict" : "field"}>
                  Ends
                  <input
                    name="endAt"
                    type="datetime-local"
                    value={formData.endAt}
                    onChange={handleChange}
                    required
                  />
                </label>

                <label className="field">
                  Timezone
                  <input
                    name="timezone"
                    type="text"
                    value={formData.timezone}
                    onChange={handleChange}
                    required
                  />
                </label>
              </div>

              {hasConflict ? (
                <div className="conflict-alert" role="alert" aria-label="Conflict warning">
                  <div className="conflict-alert-head">
                    <Icon name="alert" strokeWidth={1.8} />
                    <div>
                      <p className="conflict-alert-title">Scheduling conflict detected</p>
                      <p className="conflict-alert-subtitle">
                        This time overlaps with{" "}
                        {conflictWarning.length === 1 ? "an existing event" : "existing events"}.
                        Change the start or end time and try again.
                      </p>
                    </div>
                  </div>
                  <ul className="conflict-list">
                    {conflictWarning.map((conflict) => (
                      <li key={conflict.id} className="conflict-item">
                        <span className="conflict-item-title">{conflict.title}</span>
                        <span className="conflict-item-time">
                          {formatTime(conflict.startAt)} – {formatTime(conflict.endAt)}
                        </span>
                        {conflict.location ? (
                          <span className="conflict-item-location">{conflict.location}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="button-row" style={{ paddingLeft: 28 }}>
                    <Link className="btn btn-sm" to="/dashboard/find-time">
                      Search free slots
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="composer-group">
            <span className="composer-group-label">People</span>
            <div className="composer-group-body">
              {isEditing ? (
                <p className="field-hint" style={{ paddingTop: 26 }}>
                  Participants of an existing meeting are managed through invitations and
                  can&apos;t be changed here.
                </p>
              ) : (
                <ParticipantPicker
                  id="composer-participant-search"
                  labelText="Invite registered users"
                  selectedParticipants={pickedParticipants}
                  onParticipantsChange={setPickedParticipants}
                  searchQuery={participantSearchQuery}
                  onSearchQueryChange={setParticipantSearchQuery}
                  organizer={user}
                  disabled={isConfirmingMeeting}
                />
              )}
            </div>
          </div>

          <div className="composer-group">
            <span className="composer-group-label">Where</span>
            <div className="composer-group-body">
              <div className="field-row">
                <label className="field" style={{ flexGrow: 2 }}>
                  Book resource
                  <select name="resourceId" value={formData.resourceId} onChange={handleChange}>
                    <option value="">None</option>
                    {resources.map((res) => (
                      <option key={res.id} value={res.id}>
                        {res.name} ({res.type}, cap: {res.capacity})
                      </option>
                    ))}
                    {formData.resourceId &&
                    !resources.some((res) => res.id === formData.resourceId) ? (
                      <option value={formData.resourceId}>{formData.resourceId}</option>
                    ) : null}
                  </select>
                </label>

                <label className="field">
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

              <label className="field">
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
          </div>

          {error ? (
            <div style={{ padding: "0 24px 20px" }}>
              <p className="form-error" role="alert">
                {error.includes("replica set") ? REPLICA_SET_MESSAGE : error}
              </p>
            </div>
          ) : null}

          <div className="panel-footer">
            <span className="field-hint" style={{ flex: "1 1 200px" }}>
              {isSharedMeeting
                ? "Books you, everyone invited and the room in one step, then sends invitations."
                : "Conflicts are checked again when you save."}
            </span>

            {isEditing ? (
              <button className="btn" type="button" onClick={onCancelEdit}>
                Cancel edit
              </button>
            ) : null}

            {isSharedMeeting ? (
              <button className="btn btn-primary" type="submit" disabled={isConfirmingMeeting}>
                {isConfirmingMeeting ? "Confirming..." : "Confirm shared meeting"}
              </button>
            ) : (
              <button className="btn btn-primary" type="submit" disabled={isSaving}>
                {isSaving ? "Checking conflicts..." : isEditing ? "Update event" : "Create event"}
              </button>
            )}
          </div>
        </form>

        <aside className="split-side" aria-label="Live check">
          <section className="panel">
            <div className="panel-header">
              <h2>Checks</h2>
            </div>
            <div className="check-list" style={{ padding: "6px 0" }}>
              <CheckItem
                state={hasConflict ? "bad" : "idle"}
                title="Your calendar"
                detail={
                  hasConflict
                    ? `${conflictWarning.length} ${conflictWarning.length === 1 ? "overlap" : "overlaps"} found`
                    : "Checked for overlaps when you save"
                }
              />
              <CheckItem
                state={participantCount > 0 ? "ok" : "idle"}
                title={
                  participantCount > 0
                    ? `${participantCount} ${participantCount === 1 ? "participant" : "participants"}`
                    : "Just you"
                }
                detail={
                  participantCount > 0
                    ? "Their calendars are checked on confirmation"
                    : "Add people to send invitations"
                }
              />
              <CheckItem {...roomCheck} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-body">
              <p style={{ fontWeight: 600 }}>Not sure when?</p>
              <p className="muted">
                Search everyone&apos;s free time and pick a ranked slot. It fills this form.
              </p>
              <div>
                <Link className="btn btn-sm" to="/dashboard/find-time">
                  Open slot search
                </Link>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default EventComposerPage;
