import { useNavigate } from "react-router-dom";
import { useDashboard } from "../../hooks/useDashboard";
import {
  findMyParticipant,
  formatMinutes,
  getZonedParts,
  isEventOwner,
} from "../../utils/calendarLayout";
import { formatEventTime } from "../../utils/timezone";

const REPLICA_SET_MESSAGE =
  "Atomic scheduling requires a MongoDB replica set. Please configure a replica set on your MongoDB server to enable atomic confirmation.";

function EventsPage() {
  const navigate = useNavigate();
  const {
    user,
    userTimezone,
    formatTime,
    events,
    error,
    handleEditEvent,
    handleDeleteEvent,
    handleCancelMeeting,
    handleRespondInvitation,
  } = useDashboard();

  function startEditing(event) {
    handleEditEvent(event);
    navigate("/dashboard/events/new");
  }

  function clock(isoDate) {
    const parts = getZonedParts(isoDate, userTimezone);

    return parts ? formatMinutes(parts.minutes) : "";
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <span className="page-kicker">Your calendar</span>
          <h1>Events</h1>
          <p>Everything you organise or were invited to, earliest first.</p>
        </div>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error.includes("replica set") ? REPLICA_SET_MESSAGE : error}
        </p>
      ) : null}

      <section className="panel" aria-label="All events">
        {events.length ? (
          <div className="event-list">
            {events.map((event) => {
              const isOwner = isEventOwner(event, user);
              const isCancelled = event.status === "cancelled";
              const myParticipant = findMyParticipant(event, user);
              const rowClassName = isCancelled ? "event-row is-cancelled" : "event-row";

              return (
                <article className={rowClassName} key={event.id}>
                  <div className="event-when">
                    <strong>{formatEventTime(event.startAt, userTimezone, "EEE d MMM")}</strong>
                    <span>
                      {clock(event.startAt)}–{clock(event.endAt)}
                    </span>
                  </div>

                  <div className="event-main">
                    <div className="event-title-row">
                      <h3 className="event-title">{event.title}</h3>
                      {isCancelled ? (
                        <span className="status-badge status-cancelled">Cancelled</span>
                      ) : null}
                    </div>
                    {event.description ? (
                      <p className="event-description">{event.description}</p>
                    ) : null}

                    <dl className="event-facts">
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
                            <span className="tag tag-free">
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
                                    <span className={`status-badge status-${participant.status}`}>
                                      {participant.status}
                                    </span>
                                  ) : null}
                                </span>
                              ))
                            : "None"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="event-actions">
                    {isOwner ? (
                      <>
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => startEditing(event)}
                          disabled={isCancelled}
                        >
                          Edit
                        </button>

                        {!isCancelled && event.participants?.length > 0 ? (
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => handleCancelMeeting(event.id)}
                          >
                            Cancel meeting
                          </button>
                        ) : null}

                        <button
                          className="btn btn-sm btn-danger"
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
                            className="btn btn-sm btn-accept"
                            type="button"
                            onClick={() => handleRespondInvitation(event.id, "accepted")}
                          >
                            Accept
                          </button>
                        ) : null}
                        {myParticipant.status !== "declined" ? (
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => handleRespondInvitation(event.id, "declined")}
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
          <p className="empty-state">
            No events on your calendar. Use New event to schedule your first meeting.
          </p>
        )}
      </section>
    </main>
  );
}

export default EventsPage;
