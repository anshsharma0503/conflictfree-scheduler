import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { useDashboard } from "../hooks/useDashboard";
import { formatRelativeTime, formatReminderOption } from "../utils/relativeTime";

const TYPE_LABELS = {
  "invitation.created": "Invitation",
  "invitation.responded": "RSVP",
  "meeting.updated": "Updated",
  "meeting.cancelled": "Cancelled",
  "event.reminder": "Reminder",
};

/**
 * Top-bar bell with the unread count and a popover listing the latest
 * in-app notifications (Phase M). New ones arrive over the socket.
 */
function NotificationBell() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    notificationPreferences,
    notificationError,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    handleUpdateReminderPreference,
    formatTime,
  } = useDashboard();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();
  const reminderSelectId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleOpenNotification(notification) {
    handleMarkNotificationRead(notification.id);

    if (notification.eventId && notification.type !== "meeting.cancelled") {
      setIsOpen(false);
      navigate("/dashboard/events");
    }
  }

  const buttonLabel =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";
  const deliveryPaused =
    notificationPreferences && notificationPreferences.deliveryStatus !== "ready";

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        ref={buttonRef}
        className="icon-btn notification-trigger"
        type="button"
        aria-label={buttonLabel}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon name="bell" />
        {unreadCount > 0 ? (
          <span className="notification-count" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section
          id={panelId}
          className="notification-panel"
          role="dialog"
          aria-label="Notifications"
        >
          <header className="notification-panel-header">
            <h2>Notifications</h2>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={handleMarkAllNotificationsRead}
              disabled={unreadCount === 0}
            >
              Mark all as read
            </button>
          </header>

          {deliveryPaused ? (
            <p className="notification-notice" role="note">
              <Icon name="info" size={16} />
              New notifications and reminders are paused: the server&apos;s job queue is
              unavailable.
            </p>
          ) : null}

          {notificationError ? (
            <p className="notification-notice notification-error" role="alert">
              {notificationError}
            </p>
          ) : null}

          {notifications.length === 0 ? (
            <p className="notification-empty muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="notification-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    className={
                      notification.read ? "notification-item" : "notification-item unread"
                    }
                    onClick={() => handleOpenNotification(notification)}
                  >
                    <span className="notification-dot" aria-hidden="true" />
                    <span className="notification-body">
                      <span className="notification-message">{notification.message}</span>
                      <span className="notification-meta mono">
                        <span>{TYPE_LABELS[notification.type] || "Update"}</span>
                        {notification.data?.startAt ? (
                          <span>{formatTime(notification.data.startAt)}</span>
                        ) : null}
                        <span>{formatRelativeTime(notification.createdAt)}</span>
                      </span>
                    </span>
                    {notification.read ? null : (
                      <span className="visually-hidden"> (unread)</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {notificationPreferences ? (
            <footer className="notification-panel-footer">
              <label className="section-label" htmlFor={reminderSelectId}>
                Event reminders
              </label>
              <select
                id={reminderSelectId}
                value={notificationPreferences.reminderMinutesBefore}
                onChange={(event) => handleUpdateReminderPreference(event.target.value)}
              >
                {notificationPreferences.reminderOptions.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatReminderOption(minutes)}
                  </option>
                ))}
              </select>
            </footer>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default NotificationBell;
