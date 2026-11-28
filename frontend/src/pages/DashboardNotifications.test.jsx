import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { getLastFakeSocket } from "../test/fakeRealtimeSocket";
import { renderDashboard } from "../test/renderDashboard";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "ansh@example.com", name: "Ansh Sharma", timezone: "UTC" },
    logoutUser: vi.fn(),
  }),
}));

const ok = (body) => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });

function notification(overrides = {}) {
  return {
    id: "n-1",
    type: "invitation.created",
    message: "Raj invited you to “Roadmap review”",
    eventId: "meeting-9",
    data: {
      eventTitle: "Roadmap review",
      startAt: "2026-12-02T10:00:00.000Z",
      endAt: "2026-12-02T11:00:00.000Z",
      actorName: "Raj",
      status: "",
    },
    read: false,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi({
  notifications = [],
  unreadCount = notifications.filter((n) => !n.read).length,
  deliveryStatus = "ready",
  failNotifications = false,
} = {}) {
  const calls = [];
  let reminderMinutesBefore = 15;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      const method = options.method || "GET";
      const key = `${method} ${path}`;
      calls.push({ key, body: options.body ? JSON.parse(options.body) : undefined });

      if (key === "GET /api/events") return ok({ events: [] });
      if (key === "GET /api/resources") return ok({ resources: [] });
      if (key === "GET /api/meetings/invitations") return ok({ invitations: [] });
      if (key.startsWith("GET /api/notifications?")) {
        if (failNotifications) return { ok: false, status: 500, json: async () => ({ message: "boom" }) };
        return ok({ notifications, unreadCount });
      }
      if (key === "GET /api/notifications/preferences") {
        return ok({
          preferences: { reminderMinutesBefore, reminderOptions: [0, 5, 10, 15, 30, 60, 1440], deliveryStatus },
        });
      }
      if (key === "PATCH /api/notifications/preferences") {
        reminderMinutesBefore = JSON.parse(options.body).reminderMinutesBefore;
        return ok({
          preferences: { reminderMinutesBefore, reminderOptions: [0, 5, 10, 15, 30, 60, 1440], deliveryStatus },
        });
      }
      if (/^PATCH \/api\/notifications\/[^/]+\/read$/.test(key)) {
        return ok({ unreadCount: Math.max(0, unreadCount - 1) });
      }
      if (key === "POST /api/notifications/read-all") return ok({ updated: unreadCount, unreadCount: 0 });

      throw new Error(`No fetch mock for ${key}`);
    }),
  );

  return calls;
}

async function connectSocket() {
  await waitFor(() => expect(getLastFakeSocket()).toBeTruthy());
  const socket = getLastFakeSocket();
  act(() => socket.simulateConnect());
  return socket;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("the bell shows the unread count from the server", async () => {
  mockApi({ notifications: [notification(), notification({ id: "n-2", read: true })], unreadCount: 1 });
  renderDashboard("/dashboard");

  expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
});

test("opening the panel lists notifications with event time and an unread marker", async () => {
  mockApi({ notifications: [notification()] });
  renderDashboard("/dashboard");

  await userEvent.click(await screen.findByRole("button", { name: /Notifications, 1 unread/ }));

  const panel = screen.getByRole("dialog", { name: "Notifications" });
  const item = within(panel).getByRole("button", { name: /Raj invited you to “Roadmap review”/ });
  expect(item).toHaveTextContent("Invitation");
  expect(item).toHaveTextContent("(unread)");
  expect(item).toHaveTextContent("Just now");
  expect(item.textContent).toMatch(/Dec|2026|10:00/);
});

test("a pushed notification appears live and updates the badge", async () => {
  mockApi();
  renderDashboard("/dashboard");
  const socket = await connectSocket();
  expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();

  act(() =>
    socket.serverEmit("notification:created", {
      notification: notification({ id: "n-live", message: "Raj cancelled “Standup”", type: "meeting.cancelled" }),
      unreadCount: 1,
    }),
  );

  const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
  await userEvent.click(bell);
  expect(screen.getByText("Raj cancelled “Standup”")).toBeInTheDocument();
});

test("the same pushed notification twice is shown once", async () => {
  mockApi();
  renderDashboard("/dashboard");
  const socket = await connectSocket();

  const payload = { notification: notification({ id: "n-dup" }), unreadCount: 1 };
  act(() => socket.serverEmit("notification:created", payload));
  act(() => socket.serverEmit("notification:created", payload));

  await userEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
  expect(screen.getAllByText("Raj invited you to “Roadmap review”")).toHaveLength(1);
});

test("a reminder push is also shown on the status line", async () => {
  mockApi();
  renderDashboard("/dashboard");
  const socket = await connectSocket();

  act(() =>
    socket.serverEmit("notification:created", {
      notification: notification({ id: "n-rem", type: "event.reminder", message: "“Standup” starts in 15 minutes" }),
      unreadCount: 1,
    }),
  );

  expect(await screen.findByText("Reminder: “Standup” starts in 15 minutes")).toBeInTheDocument();
});

test("clicking a notification marks it read and opens Events", async () => {
  const calls = mockApi({ notifications: [notification()] });
  renderDashboard("/dashboard");

  await userEvent.click(await screen.findByRole("button", { name: /Notifications, 1 unread/ }));
  await userEvent.click(screen.getByRole("button", { name: /Raj invited you/ }));

  await waitFor(() =>
    expect(calls.some((c) => c.key === "PATCH /api/notifications/n-1/read")).toBe(true),
  );
  expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Events" })).toBeInTheDocument();
});

test("mark all as read clears the badge; it is disabled with nothing unread", async () => {
  const calls = mockApi({ notifications: [notification(), notification({ id: "n-2" })] });
  renderDashboard("/dashboard");

  await userEvent.click(await screen.findByRole("button", { name: /Notifications, 2 unread/ }));
  const markAll = screen.getByRole("button", { name: "Mark all as read" });
  await userEvent.click(markAll);

  expect(calls.some((c) => c.key === "POST /api/notifications/read-all")).toBe(true);
  expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
});

test("a read in another tab is applied from the socket", async () => {
  mockApi({ notifications: [notification()] });
  renderDashboard("/dashboard");
  const socket = await connectSocket();
  await screen.findByRole("button", { name: "Notifications, 1 unread" });

  act(() => socket.serverEmit("notification:read", { notificationIds: ["n-1"], unreadCount: 0 }));

  expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
});

test("the reminder setting saves the chosen lead time", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard");

  await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
  const select = await screen.findByLabelText("Event reminders");
  expect(select).toHaveValue("15");
  expect(within(select).getByRole("option", { name: "Off" })).toBeInTheDocument();
  expect(within(select).getByRole("option", { name: "1 day before" })).toBeInTheDocument();

  await userEvent.selectOptions(select, "60");

  await waitFor(() => expect(select).toHaveValue("60"));
  const patch = calls.find((c) => c.key === "PATCH /api/notifications/preferences");
  expect(patch.body).toEqual({ reminderMinutesBefore: 60 });
});

test("explains when delivery is paused because the job queue is down", async () => {
  mockApi({ deliveryStatus: "degraded" });
  renderDashboard("/dashboard");

  await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
  expect(await screen.findByRole("note")).toHaveTextContent(/paused/);
});

test("Escape closes the panel and returns focus to the bell", async () => {
  mockApi();
  renderDashboard("/dashboard");

  const bell = await screen.findByRole("button", { name: "Notifications" });
  await userEvent.click(bell);
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
  expect(screen.getByText("You're all caught up.")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  expect(bell).toHaveFocus();
});

test("a failed notification load does not break the dashboard", async () => {
  mockApi({ failNotifications: true });
  renderDashboard("/dashboard");

  expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  expect(await screen.findByText("No events yet")).toBeInTheDocument();
});

test("reconnecting refetches notifications", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard");
  const socket = await connectSocket();
  const before = calls.filter((c) => c.key.startsWith("GET /api/notifications?")).length;

  act(() => socket.simulateDisconnect());
  act(() => socket.simulateConnect());

  await waitFor(() =>
    expect(calls.filter((c) => c.key.startsWith("GET /api/notifications?")).length).toBe(before + 1),
  );
});
