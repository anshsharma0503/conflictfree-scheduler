import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { fakeSockets, getLastFakeSocket } from "../test/fakeRealtimeSocket";
import { renderDashboard } from "../test/renderDashboard";

const logoutUser = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "ansh@example.com", name: "Ansh Sharma", timezone: "UTC" },
    logoutUser,
  }),
}));

const ok = (body) => ({ ok: true, json: async () => ({ success: true, ...body }) });

function mockApi({ events = [], invitations = () => [], resources = [], onSlots } = {}) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      const key = `${options.method || "GET"} ${path}`;
      calls.push(key);

      if (key === "GET /api/events") return ok({ events });
      if (key === "GET /api/resources") return ok({ resources });
      if (key === "GET /api/meetings/invitations") return ok({ invitations: invitations() });
      if (key === "POST /api/scheduling/available-slots") {
        onSlots?.();
        return ok({
          slots: [{ startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T10:00:00.000Z" }],
        });
      }

      throw new Error(`No fetch mock for ${key}`);
    }),
  );
  return calls;
}

function personalEvent(overrides = {}) {
  return {
    id: "event-1",
    owner: "user-123",
    title: "Focus block",
    description: "",
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T10:00:00.000Z",
    timezone: "UTC",
    location: "",
    status: "active",
    participants: [],
    resource: null,
    ...overrides,
  };
}

async function connectSocket() {
  await waitFor(() => expect(getLastFakeSocket()).toBeTruthy());
  const socket = getLastFakeSocket();
  act(() => socket.simulateConnect());
  return socket;
}

beforeEach(() => {
  vi.restoreAllMocks();
  logoutUser.mockReset();
});

test("shows the live connection state and keeps one socket across dashboard navigation", async () => {
  mockApi();
  renderDashboard("/dashboard");

  expect(await screen.findByText("Connecting…")).toBeInTheDocument();
  const socket = await connectSocket();
  expect(screen.getByText("Live")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("link", { name: /Events/ }));
  await userEvent.click(screen.getByRole("link", { name: /Find a time/ }));

  expect(fakeSockets).toHaveLength(1);
  expect(socket.listenerCount("invitation:created")).toBe(1);

  act(() => socket.simulateDisconnect());
  expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
});

test("a pushed invitation appears in the inbox without a page refresh", async () => {
  let pending = [];
  mockApi({ invitations: () => pending });
  renderDashboard("/dashboard");
  const socket = await connectSocket();

  const meeting = {
    id: "meeting-9",
    owner: "organizer-1",
    organizer: { id: "organizer-1", name: "Raj", email: "raj@example.com" },
    title: "Roadmap review",
    startAt: "2026-12-02T10:00:00.000Z",
    endAt: "2026-12-02T11:00:00.000Z",
    status: "active",
    participants: [{ user: "user-123", email: "ansh@example.com", status: "pending" }],
  };
  pending = [meeting];

  act(() => socket.serverEmit("invitation:created", { meeting }));

  expect(await screen.findByText("New invitation: Roadmap review")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Accept" })).toBeInTheDocument();
});

test("pushed event updates and deletions are applied in place", async () => {
  mockApi({ events: [personalEvent()] });
  renderDashboard("/dashboard/events");
  expect(await screen.findByText("Focus block")).toBeInTheDocument();
  const socket = await connectSocket();

  act(() =>
    socket.serverEmit("event:updated", { event: personalEvent({ title: "Deep work" }) }),
  );
  expect(await screen.findByText("Deep work")).toBeInTheDocument();
  expect(screen.queryByText("Focus block")).not.toBeInTheDocument();

  act(() => socket.serverEmit("event:deleted", { eventId: "event-1" }));
  await waitFor(() => expect(screen.queryByText("Deep work")).not.toBeInTheDocument());
});

test("a cancelled meeting pushed by the organizer updates the invitee's event status", async () => {
  const meeting = personalEvent({
    id: "meeting-5",
    owner: "organizer-1",
    organizer: { id: "organizer-1", name: "Raj", email: "raj@example.com" },
    title: "Weekly sync",
    participants: [{ user: "user-123", email: "ansh@example.com", status: "accepted" }],
  });
  mockApi({ events: [meeting] });
  renderDashboard("/dashboard/events");
  expect(await screen.findByText("Weekly sync")).toBeInTheDocument();
  const socket = await connectSocket();
  expect(screen.queryByText(/Cancelled/i)).not.toBeInTheDocument();

  act(() =>
    socket.serverEmit("meeting:cancelled", { meeting: { ...meeting, status: "cancelled" } }),
  );

  expect(await screen.findByText(/Cancelled/i)).toBeInTheDocument();
});

test("a booking change marks slot results stale and 'Search again' re-runs the search", async () => {
  let searches = 0;
  mockApi({ onSlots: () => (searches += 1) });
  renderDashboard("/dashboard/find-time");
  const socket = await connectSocket();

  fireEvent.change(screen.getByLabelText("Window start"), { target: { value: "2026-12-01T09:00" } });
  fireEvent.change(screen.getByLabelText("Window end"), { target: { value: "2026-12-01T12:00" } });
  await userEvent.click(screen.getByRole("button", { name: "Find available slots" }));
  await screen.findByRole("region", { name: "Available slots" });
  expect(searches).toBe(1);
  expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument();

  act(() => socket.serverEmit("resource:booking-changed", { resourceId: "room-1" }));
  expect(await screen.findByText(/may be out of date/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Search again" }));
  await waitFor(() => expect(searches).toBe(2));
  await waitFor(() => expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument());
});

test("pushed resource catalogue changes update the resource list", async () => {
  mockApi({
    resources: [{ id: "r1", name: "Alpha Room", type: "room", capacity: 4, isActive: true }],
  });
  renderDashboard("/dashboard/resources");
  expect(await screen.findByText("Alpha Room")).toBeInTheDocument();
  const socket = await connectSocket();

  act(() =>
    socket.serverEmit("resource:created", {
      resource: { id: "r2", name: "Beta Room", type: "room", capacity: 8, isActive: true },
    }),
  );
  expect(await screen.findByText("Beta Room")).toBeInTheDocument();

  act(() =>
    socket.serverEmit("resource:deactivated", {
      resource: { id: "r1", name: "Alpha Room", isActive: false },
    }),
  );
  await waitFor(() => expect(screen.queryByText("Alpha Room")).not.toBeInTheDocument());
});

test("after a reconnect the dashboard refetches events, invitations and resources", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard");
  const socket = await connectSocket();
  await waitFor(() => expect(calls.filter((c) => c === "GET /api/events")).toHaveLength(1));

  act(() => socket.simulateDisconnect());
  act(() => socket.simulateConnect());

  await waitFor(() => {
    expect(calls.filter((c) => c === "GET /api/events")).toHaveLength(2);
    expect(calls.filter((c) => c === "GET /api/meetings/invitations")).toHaveLength(2);
    expect(calls.filter((c) => c === "GET /api/resources")).toHaveLength(2);
  });
});

test("session expiry pushed by the server logs the user out", async () => {
  mockApi();
  renderDashboard("/dashboard");
  const socket = await connectSocket();

  act(() => socket.serverEmit("session:expired", { reason: "token_expired" }));

  await waitFor(() => expect(logoutUser).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Offline")).toBeInTheDocument();
});

test("an event created here is shown once even when its push arrives before the HTTP response", async () => {
  const created = personalEvent({ id: "event-new", title: "Race-free event" });
  let socket;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      const key = `${options.method || "GET"} ${path}`;
      if (key === "GET /api/events") return ok({ events: [] });
      if (key === "GET /api/resources") return ok({ resources: [] });
      if (key === "GET /api/meetings/invitations") return ok({ invitations: [] });
      if (key === "POST /api/scheduling/conflicts") return ok({ hasConflict: false, conflicts: [] });
      if (key === "POST /api/events") {
        // The server pushes event:created to this user's sockets before the
        // HTTP response reaches the browser.
        act(() => socket.serverEmit("event:created", { event: created }));
        return ok({ event: created });
      }
      throw new Error(`No fetch mock for ${key}`);
    }),
  );

  renderDashboard("/dashboard/events/new");
  socket = await connectSocket();

  await userEvent.type(screen.getByLabelText("Title"), "Race-free event");
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-01T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-12-01T10:00" } });
  await userEvent.click(screen.getByRole("button", { name: "Create event" }));

  expect(await screen.findByText("Event created successfully")).toBeInTheDocument();
  expect(screen.getAllByText("Race-free event")).toHaveLength(1);
});
