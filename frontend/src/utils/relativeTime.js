const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Short "how long ago" label for notification timestamps:
 * "Just now", "5 min ago", "3 h ago", "2 d ago".
 */
export function formatRelativeTime(isoDate, now = Date.now()) {
  const time = new Date(isoDate).getTime();

  if (!Number.isFinite(time)) {
    return "";
  }

  const elapsed = Math.max(0, now - time);

  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

/** Label for a reminder lead time option (0 = off). */
export function formatReminderOption(minutes) {
  if (minutes === 0) return "Off";
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes < 1440) return minutes === 60 ? "1 hour before" : `${minutes / 60} hours before`;
  return minutes === 1440 ? "1 day before" : `${minutes / 1440} days before`;
}
