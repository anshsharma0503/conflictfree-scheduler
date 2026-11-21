import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

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

export function toDateTimeLocalValue(isoDate, timezone = "UTC") {
  if (!isoDate) {
    return "";
  }

  const tz = normalizeTimezone(timezone);
  const d = isoDate instanceof Date ? isoDate : new Date(isoDate);

  if (isNaN(d.getTime())) {
    return "";
  }

  return formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm");
}

export function toIsoDate(dateTimeLocalValue, timezone = "UTC") {
  if (!dateTimeLocalValue) {
    return "";
  }

  const tz = normalizeTimezone(timezone);

  if (typeof dateTimeLocalValue === "string") {
    const trimmed = dateTimeLocalValue.trim();
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? "" : d.toISOString();
    }

    try {
      const utcDate = fromZonedTime(trimmed, tz);
      return isNaN(utcDate.getTime()) ? "" : utcDate.toISOString();
    } catch {
      return "";
    }
  }

  if (dateTimeLocalValue instanceof Date) {
    return isNaN(dateTimeLocalValue.getTime()) ? "" : dateTimeLocalValue.toISOString();
  }

  return "";
}

export function formatEventTime(
  isoDate,
  timezone = "UTC",
  formatStr = "MMM d, yyyy, h:mm a",
) {
  if (!isoDate) {
    return "";
  }

  const tz = normalizeTimezone(timezone);
  const d = isoDate instanceof Date ? isoDate : new Date(isoDate);

  if (isNaN(d.getTime())) {
    return "";
  }

  return formatInTimeZone(d, tz, formatStr);
}
