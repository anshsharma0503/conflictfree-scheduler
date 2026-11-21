import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import {
  addDaysToKey,
  buildWeek,
  formatMinutes,
  getTodayKey,
  getWeekStartKey,
  getZonedParts,
} from "../../utils/calendarLayout";

const HOUR_HEIGHT = 48;

function getBlockStyle(item, startHour) {
  const top = ((item.startMin - startHour * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(((item.endMin - item.startMin) / 60) * HOUR_HEIGHT - 2, 20);
  const width = 100 / item.columns;

  return {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${item.column * width}% + 3px)`,
    width: `calc(${width}% - 6px)`,
  };
}

function getBlockClassName(item) {
  const classes = ["wk-event", `kind-${item.kind}`];

  if (item.isConflict) {
    classes.push("is-conflict");
  }

  return classes.join(" ");
}

function formatWeekTitle(days) {
  const first = days[0];
  const last = days[6];

  if (first.month === last.month) {
    return `${first.dayOfMonth}–${last.dayOfMonth} ${first.month} ${first.year}`;
  }

  return `${first.dayOfMonth} ${first.month} – ${last.dayOfMonth} ${last.month} ${last.year}`;
}

/**
 * Seven-day calendar of the signed-in user's events, positioned in their
 * own timezone. Overlapping events are drawn side by side in conflict colours.
 */
function WeekCalendar({ events, timezone, user }) {
  const [now, setNow] = useState(() => new Date());
  const todayKey = getTodayKey(timezone, now);
  const [weekStartKey, setWeekStartKey] = useState(() => getWeekStartKey(todayKey));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  const week = useMemo(
    () => buildWeek(events, { timezone, weekStartKey, todayKey, user }),
    [events, timezone, weekStartKey, todayKey, user],
  );

  const hours = Array.from(
    { length: week.endHour - week.startHour },
    (_, index) => week.startHour + index,
  );
  const bodyHeight = hours.length * HOUR_HEIGHT;
  const nowParts = getZonedParts(now, timezone);
  const nowTop = ((nowParts.minutes - week.startHour * 60) / 60) * HOUR_HEIGHT;
  const showNow = nowTop >= 0 && nowTop <= bodyHeight;
  const isCurrentWeek = weekStartKey === getWeekStartKey(todayKey);
  const weekEventCount = week.days.reduce((total, day) => total + day.items.length, 0);

  return (
    <section className="panel" aria-label="Week calendar">
      <div className="panel-header">
        <h2>{formatWeekTitle(week.days)}</h2>
        <span className="muted mono">
          {weekEventCount} {weekEventCount === 1 ? "event" : "events"}
        </span>
        <div className="button-row">
          <button
            className="icon-btn"
            type="button"
            aria-label="Previous week"
            onClick={() => setWeekStartKey((key) => addDaysToKey(key, -7))}
          >
            <Icon name="chevronLeft" />
          </button>
          <button
            className="btn btn-sm"
            type="button"
            disabled={isCurrentWeek}
            onClick={() => setWeekStartKey(getWeekStartKey(todayKey))}
          >
            This week
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Next week"
            onClick={() => setWeekStartKey((key) => addDaysToKey(key, 7))}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>

      <div className="week-scroll">
        <div className="week">
          <div className="week-head">
            <div />
            {week.days.map((day) => (
              <div
                key={day.dateKey}
                className={day.isToday ? "week-day-label is-today" : "week-day-label"}
              >
                <span>{day.weekday}</span>
                <span className="mono">{day.dayOfMonth}</span>
              </div>
            ))}
          </div>

          <div className="week-body">
            <div className="week-hours" style={{ height: `${bodyHeight}px` }} aria-hidden="true">
              {hours.slice(1).map((hour, index) => (
                <span key={hour} style={{ top: `${(index + 1) * HOUR_HEIGHT}px` }}>
                  {formatMinutes(hour * 60)}
                </span>
              ))}
            </div>

            {week.days.map((day) => {
              const columnClasses = ["week-col"];

              if (day.isToday) {
                columnClasses.push("is-today");
              } else if (day.isWeekend) {
                columnClasses.push("is-weekend");
              }

              return (
                <div
                  key={day.dateKey}
                  className={columnClasses.join(" ")}
                  style={{ height: `${bodyHeight}px` }}
                >
                  {day.items.map((item) => (
                    <div
                      key={item.id}
                      className={getBlockClassName(item)}
                      style={getBlockStyle(item, week.startHour)}
                      title={`${item.title} · ${formatMinutes(item.startMin)}–${formatMinutes(item.endMin)}`}
                    >
                      <span className="wk-event-title">{item.title}</span>
                      <span className="wk-event-time">
                        {formatMinutes(item.startMin)}–{formatMinutes(item.endMin)}
                        {item.isConflict ? " · overlap" : ""}
                      </span>
                    </div>
                  ))}

                  {day.isToday && showNow ? (
                    <div
                      className="wk-now"
                      style={{ top: `${nowTop}px` }}
                      role="img"
                      aria-label={`Now, ${formatMinutes(nowParts.minutes)}`}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="legend">
        <span>
          <span className="swatch swatch-shared" aria-hidden="true" />
          With people or a room
        </span>
        <span>
          <span className="swatch" aria-hidden="true" />
          Personal
        </span>
        <span>
          <span className="swatch swatch-invite" aria-hidden="true" />
          Invitation
        </span>
        <span>
          <span className="swatch swatch-conflict" aria-hidden="true" />
          Conflict
        </span>
      </div>
    </section>
  );
}

export default WeekCalendar;
