import { formatInTimeZone } from "date-fns-tz";
import { normalizeTimezone } from "./timezone";

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 19;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(utcDate) {
  return utcDate.toISOString().slice(0, 10);
}

/** Calendar date (yyyy-MM-dd) and minutes after midnight in a timezone. */
export function getZonedParts(isoDate, timezone) {
  const tz = normalizeTimezone(timezone);
  const date = isoDate instanceof Date ? isoDate : new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const [dateKey, time] = formatInTimeZone(date, tz, "yyyy-MM-dd HH:mm").split(" ");
  const [hours, minutes] = time.split(":").map(Number);

  return { dateKey, minutes: hours * 60 + minutes };
}

export function getTodayKey(timezone, now = new Date()) {
  return getZonedParts(now, timezone).dateKey;
}

export function addDaysToKey(dateKey, days) {
  const date = parseDateKey(dateKey);

  date.setUTCDate(date.getUTCDate() + days);

  return toDateKey(date);
}

/** Monday of the week that contains dateKey. */
export function getWeekStartKey(dateKey) {
  const weekday = parseDateKey(dateKey).getUTCDay();
  const offsetFromMonday = (weekday + 6) % 7;

  return addDaysToKey(dateKey, -offsetFromMonday);
}

export function describeDateKey(dateKey) {
  const date = parseDateKey(dateKey);
  const weekday = date.getUTCDay();

  return {
    dateKey,
    weekday: WEEKDAY_SHORT[weekday],
    dayOfMonth: date.getUTCDate(),
    month: MONTH_SHORT[date.getUTCMonth()],
    year: date.getUTCFullYear(),
    isWeekend: weekday === 0 || weekday === 6,
  };
}

export function formatMinutes(totalMinutes) {
  const clamped = Math.max(0, Math.min(totalMinutes, MINUTES_PER_DAY));
  const hours = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minutes = String(clamped % 60).padStart(2, "0");

  return `${hours}:${minutes}`;
}

export function isEventOwner(event, user) {
  if (!event.owner) {
    return true;
  }

  if (event.owner === user?.id) {
    return true;
  }

  return typeof event.owner === "object" && event.owner?._id === user?.id;
}

export function findMyParticipant(event, user) {
  return event.participants?.find(
    (participant) =>
      (participant.user && participant.user === user?.id) ||
      (participant.email &&
        participant.email.toLowerCase() === user?.email?.toLowerCase()),
  );
}

/**
 * Visual category of an event on the calendar:
 * - "invite": someone else's meeting that I have not answered yet
 * - "shared": has participants or a booked resource
 * - "personal": everything else
 */
export function getEventKind(event, user) {
  if (!isEventOwner(event, user)) {
    const me = findMyParticipant(event, user);

    if (me?.status === "pending") {
      return "invite";
    }
  }

  if (event.participants?.length || event.resourceDetails || event.resource) {
    return "shared";
  }

  return "personal";
}

function rangesOverlap(first, second) {
  return first.startMin < second.endMin && second.startMin < first.endMin;
}

/**
 * Places a single day's items into side-by-side columns.
 * Items that overlap are split into columns; any item that overlaps
 * another is flagged as a conflict.
 */
export function layoutDayItems(items) {
  const sorted = [...items].sort(
    (first, second) => first.startMin - second.startMin || second.endMin - first.endMin,
  );
  const laidOut = [];
  let cluster = [];
  let clusterEnd = -1;

  function flushCluster() {
    const columnEnds = [];

    cluster.forEach((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMin);

      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(item.endMin);
      } else {
        columnEnds[column] = item.endMin;
      }

      item.column = column;
    });

    cluster.forEach((item) => {
      laidOut.push({
        ...item,
        columns: columnEnds.length,
        isConflict: cluster.some((other) => other !== item && rangesOverlap(item, other)),
      });
    });

    cluster = [];
    clusterEnd = -1;
  }

  sorted.forEach((item) => {
    if (cluster.length && item.startMin >= clusterEnd) {
      flushCluster();
    }

    cluster.push({ ...item });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  });

  if (cluster.length) {
    flushCluster();
  }

  return laidOut;
}

/**
 * Builds the seven columns of a week view for the given events.
 * Cancelled events are left out. The visible hour range expands to fit
 * early or late events.
 */
export function buildWeek(events, { timezone, weekStartKey, todayKey, user }) {
  const dayKeys = Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStartKey, index));
  const itemsByDay = Object.fromEntries(dayKeys.map((key) => [key, []]));
  let earliest = DEFAULT_START_HOUR * 60;
  let latest = DEFAULT_END_HOUR * 60;

  events.forEach((event) => {
    if (event.status === "cancelled") {
      return;
    }

    const start = getZonedParts(event.startAt, timezone);
    const end = getZonedParts(event.endAt, timezone);

    if (!start || !end || !itemsByDay[start.dateKey]) {
      return;
    }

    const endMin = end.dateKey === start.dateKey ? end.minutes : MINUTES_PER_DAY;

    if (endMin <= start.minutes) {
      return;
    }

    earliest = Math.min(earliest, start.minutes);
    latest = Math.max(latest, endMin);

    itemsByDay[start.dateKey].push({
      id: event.id,
      title: event.title,
      location: event.location,
      startMin: start.minutes,
      endMin,
      kind: getEventKind(event, user),
    });
  });

  const startHour = Math.floor(earliest / 60);
  const endHour = Math.min(24, Math.ceil(latest / 60));

  return {
    startHour,
    endHour,
    days: dayKeys.map((key) => ({
      ...describeDateKey(key),
      isToday: key === todayKey,
      items: layoutDayItems(itemsByDay[key]),
    })),
  };
}

/**
 * Pairs of active events that overlap and have not finished yet,
 * earliest first.
 */
export function findUpcomingConflicts(events, now = new Date()) {
  const active = events
    .filter((event) => event.status !== "cancelled" && new Date(event.endAt) > now)
    .map((event) => ({
      event,
      start: new Date(event.startAt).getTime(),
      end: new Date(event.endAt).getTime(),
    }))
    .filter((item) => !Number.isNaN(item.start) && !Number.isNaN(item.end))
    .sort((first, second) => first.start - second.start);

  const conflicts = [];

  active.forEach((first, index) => {
    active.slice(index + 1).forEach((second) => {
      if (first.start < second.end && second.start < first.end) {
        conflicts.push({
          first: first.event,
          second: second.event,
          overlapStart: new Date(Math.max(first.start, second.start)).toISOString(),
          overlapEnd: new Date(Math.min(first.end, second.end)).toISOString(),
        });
      }
    });
  });

  return conflicts;
}
