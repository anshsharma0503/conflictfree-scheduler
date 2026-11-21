import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export function isValidTimezone(timezone) {
  if (!timezone || typeof timezone !== "string") {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone.trim() });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(timezone, defaultTimezone = "UTC") {
  if (isValidTimezone(timezone)) {
    return timezone.trim();
  }

  return defaultTimezone;
}

export function getTimePartsInTimezone(date, timezone = "UTC") {
  const tz = normalizeTimezone(timezone);
  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) {
    throw new Error("Invalid date provided");
  }

  const zoned = toZonedTime(d, tz);

  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    second: zoned.getSeconds(),
  };
}

export function getHourInTimezone(date, timezone = "UTC") {
  return getTimePartsInTimezone(date, timezone).hour;
}

export function getMinuteInTimezone(date, timezone = "UTC") {
  return getTimePartsInTimezone(date, timezone).minute;
}

export function localDateTimeToUtc(localDateTime, timezone = "UTC") {
  if (!localDateTime) {
    throw new Error("localDateTime is required");
  }

  const tz = normalizeTimezone(timezone);

  if (localDateTime instanceof Date) {
    if (isNaN(localDateTime.getTime())) {
      throw new Error("Invalid date provided");
    }
    return localDateTime;
  }

  if (typeof localDateTime === "string") {
    const trimmed = localDateTime.trim();
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
      const d = new Date(trimmed);
      if (isNaN(d.getTime())) {
        throw new Error("Invalid date string provided");
      }
      return d;
    }

    const utcDate = fromZonedTime(trimmed, tz);
    if (isNaN(utcDate.getTime())) {
      throw new Error("Invalid date string provided");
    }
    return utcDate;
  }

  throw new Error("localDateTime must be a string or Date");
}

export function utcToLocalDateTime(date, timezone = "UTC") {
  if (!date) {
    return "";
  }

  const tz = normalizeTimezone(timezone);
  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) {
    throw new Error("Invalid date provided");
  }

  return formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm");
}

export function formatDateInTimezone(
  date,
  timezone = "UTC",
  formatStr = "MMM d, yyyy, h:mm a",
) {
  if (!date) {
    return "";
  }

  const tz = normalizeTimezone(timezone);
  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) {
    throw new Error("Invalid date provided");
  }

  return formatInTimeZone(d, tz, formatStr);
}
