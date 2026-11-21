import { Link } from "react-router-dom";
import Icon from "../../components/Icon";
import WeekCalendar from "../../components/dashboard/WeekCalendar";
import { useDashboard } from "../../hooks/useDashboard";
import {
  describeDateKey,
  findUpcomingConflicts,
  formatMinutes,
  getTodayKey,
  getZonedParts,
} from "../../utils/calendarLayout";
import { formatEventTime } from "../../utils/timezone";

const REPLICA_SET_MESSAGE =
  "Atomic scheduling requires a MongoDB replica set. Please configure a replica set on your MongoDB server to enable atomic confirmation.";

function formatClock(isoDate, timezone) {
  const parts = getZonedParts(isoDate, timezone);

  return parts ? formatMinutes(parts.minutes) : "";
}

function getTodayAgenda(events, timezone, now) {
  const todayKey = getTodayKey(timezone, now);

  return events.filter((event) => {
    if (event.status === "cancelled" || new Date(event.endAt) <= now) {
      return false;
    }

    return getZonedParts(event.startAt, timezone)?.dateKey === todayKey;
  });
}

function OverviewPage() {
  const {
    user,
    userTimezone,
    events,
    invitations,
    invitationMessage,
    invitationError,
    handleRespondInvitation,
  } = useDashboard();

  const now = new Date();
  const today = describeDateKey(getTodayKey(userTimezone, now));
  const conflicts = findUpcomingConflicts(events, now);
  const agenda = getTodayAgenda(events, userTimezone, now);
  const firstConflict = conflicts[0];
  const showInvitations = invitations.length > 0 || invitationMessage || invitationError;

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <span className="page-kicker">
            {today.weekday} {today.dayOfMonth} {today.month} {today.year} · {userTimezone}
          </span>
          <h1>Welcome, {user?.name}</h1>
          <p>
            {conflicts.length > 0 ? (
              <>
                You have{" "}
                <strong style={{ color: "var(--conflict)" }}>
                  {conflicts.length} {conflicts.length === 1 ? "overlap" : "overlaps"}
                </strong>{" "}
                coming up. Everything else is conflict-free.
              </>
            ) : (
              "Nothing on your calendar overlaps. New events are checked before they are saved."
            )}
          </p>
        </div>
      </div>

      <div className="split">
        <div className="split-main">
          <WeekCalendar events={events} timezone={userTimezone} user={user} />
        </div>

        <div className="split-side">
          {firstConflict ? (
            <section className="panel attention" aria-labelledby="attention-title">
              <div className="panel-body">
                <div className="attention-title">
                  <Icon name="alert" strokeWidth={1.8} />
                  <h2 id="attention-title">Needs a decision</h2>
                </div>
                <div>
                  <p className="attention-headline">
                    {firstConflict.first.title} overlaps {firstConflict.second.title}
                  </p>
                  <p className="attention-meta">
                    {formatEventTime(firstConflict.overlapStart, userTimezone, "EEE d MMM")} ·{" "}
                    {formatClock(firstConflict.overlapStart, userTimezone)}–
                    {formatClock(firstConflict.overlapEnd, userTimezone)}
                  </p>
                </div>
                <div className="button-row">
                  <Link className="btn btn-primary btn-sm" to="/dashboard/find-time">
                    Find a new time
                  </Link>
                  <Link className="btn btn-sm" to="/dashboard/events">
                    Review events
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          {showInvitations ? (
            <section className="panel" aria-labelledby="invitations-title">
              <div className="panel-header">
                <h2 id="invitations-title">Meeting invitations ({invitations.length})</h2>
              </div>

              {invitationMessage ? (
                <div className="panel-body">
                  <p className="form-success" role="status">
                    {invitationMessage}
                  </p>
                </div>
              ) : null}

              {invitationError ? (
                <div className="panel-body">
                  <p className="form-error" role="alert">
                    {invitationError.includes("replica set") ? REPLICA_SET_MESSAGE : invitationError}
                  </p>
                </div>
              ) : null}

              {invitations.map((inv) => (
                <article className="invite-item" key={inv.id}>
                  <div className="event-title-row">
                    <h3>{inv.title}</h3>
                    <span className="status-badge status-pending">Pending</span>
                  </div>
                  <div className="invite-meta">
                    <span className="mono">
                      {formatEventTime(inv.startAt, userTimezone)} –{" "}
                      {formatClock(inv.endAt, userTimezone)}
                    </span>
                    <span>
                      From{" "}
                      {inv.organizer?.name
                        ? `${inv.organizer.name} (${inv.organizer.email})`
                        : inv.organizer?.email || "Unknown"}
                    </span>
                    {inv.resourceDetails ? (
                      <span>
                        {inv.resourceDetails.name} ({inv.resourceDetails.type})
                      </span>
                    ) : null}
                    {inv.description ? <span>{inv.description}</span> : null}
                  </div>
                  <div className="invite-actions">
                    <button
                      className="btn btn-accept"
                      type="button"
                      onClick={() => handleRespondInvitation(inv.id, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => handleRespondInvitation(inv.id, "declined")}
                    >
                      Decline
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          <section className="panel" aria-labelledby="today-title">
            <div className="panel-header">
              <h2 id="today-title">Rest of today</h2>
            </div>
            <div className="panel-body">
              {agenda.length ? (
                <div className="agenda">
                  {agenda.map((event) => (
                    <div key={event.id} style={{ display: "contents" }}>
                      <span className="mono">{formatClock(event.startAt, userTimezone)}</span>
                      <div className="agenda-item">
                        <span>{event.title}</span>
                        <span>
                          until {formatClock(event.endAt, userTimezone)}
                          {event.location ? ` · ${event.location}` : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Nothing else scheduled today.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default OverviewPage;
