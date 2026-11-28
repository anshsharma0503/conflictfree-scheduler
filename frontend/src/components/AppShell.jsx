import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { getBrowserTimezone, updateTimezone } from "../services/authService";
import BrandMark from "./BrandMark";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import { useAuth } from "../context/AuthContext";
import { useDashboard } from "../hooks/useDashboard";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Overview", icon: "overview", end: true },
  { to: "/dashboard/events", label: "Events", icon: "list", end: true },
  { to: "/dashboard/find-time", label: "Find a time", icon: "findTime" },
  { to: "/dashboard/resources", label: "Rooms & equipment", icon: "door" },
];

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getNavClassName({ isActive }) {
  return isActive ? "nav-link active" : "nav-link";
}

const REALTIME_LABELS = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

function AppShell() {
  const navigate = useNavigate();
  const { logoutUser, setAuthUser } = useAuth();
  const [browserTimezone] = useState(() => getBrowserTimezone());
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [timezoneError, setTimezoneError] = useState("");

  // Accounts created before timezones were recorded (and Google sign-ins)
  // are UTC; one click aligns the account with this browser (Decision 51).
  async function handleUseBrowserTimezone() {
    setIsSavingTimezone(true);
    setTimezoneError("");

    try {
      const updatedUser = await updateTimezone(browserTimezone);
      setAuthUser?.(updatedUser);
    } catch (error) {
      setTimezoneError(error.message);
    } finally {
      setIsSavingTimezone(false);
    }
  }
  const {
    user,
    userTimezone,
    statusMessage,
    error,
    invitations,
    isEditing,
    resetForm,
    realtimeStatus,
  } = useDashboard();

  async function handleLogout() {
    await logoutUser();
    navigate("/");
  }

  function handleNewEvent() {
    if (isEditing) {
      resetForm();
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <BrandMark to="/dashboard" />

        <nav className="nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={getNavClassName}>
              <Icon name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {item.icon === "overview" && invitations.length > 0 ? (
                <span className="count-badge">
                  {invitations.length}
                  <span className="visually-hidden"> pending invitations</span>
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-section">
          <span className="section-label">Time zone</span>
          <span className="sidebar-calendar mono">
            <span className="dot dot-free" aria-hidden="true" />
            {userTimezone}
          </span>
          {browserTimezone && browserTimezone !== userTimezone ? (
            <button
              className="btn btn-ghost btn-sm timezone-switch"
              type="button"
              onClick={handleUseBrowserTimezone}
              disabled={isSavingTimezone}
            >
              Use {browserTimezone}
            </button>
          ) : null}
          {timezoneError ? (
            <span className="field-hint" role="alert">
              {timezoneError}
            </span>
          ) : null}
        </div>

        <div className="sidebar-user">
          {user?.avatarUrl ? (
            <img className="avatar avatar-sm" src={user.avatarUrl} alt="" />
          ) : (
            <span className="avatar avatar-sm" aria-hidden="true">
              {getInitials(user?.name)}
            </span>
          )}
          <div>
            <span className="user-name">{user?.name}</span>
            <span className="user-email">{user?.email}</span>
          </div>
          <button className="icon-btn" type="button" aria-label="Log out" onClick={handleLogout}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="shell-content">
        <header className="topbar">
          <p className="status-line" role="status">
            <span
              className={error ? "dot dot-conflict" : "dot dot-free"}
              aria-hidden="true"
            />
            <span>{statusMessage}</span>
          </p>
          <span
            className="live-indicator"
            data-state={realtimeStatus}
            aria-live="polite"
            title="Real-time updates"
          >
            <span className="live-dot" aria-hidden="true" />
            {REALTIME_LABELS[realtimeStatus] || "Offline"}
          </span>
          <NotificationBell />
          <Link className="btn btn-primary" to="/dashboard/events/new" onClick={handleNewEvent}>
            <Icon name="plus" size={16} strokeWidth={2} />
            New event
          </Link>
        </header>

        <Outlet />
      </div>
    </div>
  );
}

export default AppShell;
