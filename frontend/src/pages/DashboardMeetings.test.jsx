import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { renderDashboard } from "../test/renderDashboard";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
      timezone: "UTC",
    },
  }),
}));

function mockFetchWithHandlers(handlers) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      const method = options.method || "GET";
      const key = `${method} ${path}`;
      const handler = handlers[key];

      if (!handler) {
        throw new Error(`No fetch mock for ${key}`);
      }

      return handler(options);
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("1. Displays pending invitations in invitations inbox and allows accept", async () => {
  let accepted = false;

  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "GET /api/meetings/invitations": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        invitations: accepted
          ? []
          : [
              {
                id: "meeting-777",
                title: "Sprint Retrospective",
                description: "Review sprint goals",
                startAt: "2026-11-20T10:00:00.000Z",
                endAt: "2026-11-20T11:00:00.000Z",
                status: "active",
                organizer: {
                  name: "Boss Person",
                  email: "boss@example.com",
                },
                participants: [
                  {
                    email: "ansh@example.com",
                    name: "Ansh Sharma",
                    status: "pending",
                  },
                ],
              },
            ],
      }),
    }),
    "PATCH /api/meetings/meeting-777/invitation-response": async (options) => {
      const body = JSON.parse(options.body);
      expect(body.action).toBe("accepted");
      accepted = true;
      return {
        ok: true,
        json: async () => ({
          success: true,
          meeting: { id: "meeting-777", title: "Sprint Retrospective" },
        }),
      };
    },
  });

  renderDashboard("/dashboard");

  expect(await screen.findByText("Sprint Retrospective")).toBeInTheDocument();
  expect(screen.getByText("Review sprint goals")).toBeInTheDocument();
  expect(screen.getByText("Meeting invitations (1)")).toBeInTheDocument();

  const acceptBtn = screen.getByRole("button", { name: "Accept" });
  await userEvent.click(acceptBtn);

  await waitFor(() => {
    expect(screen.getByText("Invitation accepted successfully")).toBeInTheDocument();
  });
});

test("2. Displays decline button and handles invitation decline", async () => {
  let declined = false;

  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "GET /api/meetings/invitations": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        invitations: declined
          ? []
          : [
              {
                id: "meeting-888",
                title: "Optional Brainstorm",
                startAt: "2026-11-20T14:00:00.000Z",
                endAt: "2026-11-20T15:00:00.000Z",
                status: "active",
                organizer: { email: "peer@example.com" },
                participants: [{ email: "ansh@example.com", status: "pending" }],
              },
            ],
      }),
    }),
    "PATCH /api/meetings/meeting-888/invitation-response": async (options) => {
      const body = JSON.parse(options.body);
      expect(body.action).toBe("declined");
      declined = true;
      return {
        ok: true,
        json: async () => ({
          success: true,
          meeting: { id: "meeting-888", title: "Optional Brainstorm" },
        }),
      };
    },
  });

  renderDashboard("/dashboard");

  expect(await screen.findByText("Optional Brainstorm")).toBeInTheDocument();
  const declineBtn = screen.getByRole("button", { name: "Decline" });
  await userEvent.click(declineBtn);

  await waitFor(() => {
    expect(screen.getByText("Invitation declined successfully")).toBeInTheDocument();
  });
});

test("3. Organizer sees Cancel meeting button on active shared meeting and can cancel it", async () => {
  let cancelled = false;

  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        events: [
          {
            id: "meeting-999",
            owner: "user-123",
            title: "Project Kickoff",
            description: "Kickoff with team",
            startAt: "2026-11-21T09:00:00.000Z",
            endAt: "2026-11-21T10:00:00.000Z",
            status: cancelled ? "cancelled" : "active",
            participants: [
              {
                email: "raj@example.com",
                name: "Raj Patel",
                status: "accepted",
              },
            ],
          },
        ],
      }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "GET /api/meetings/invitations": async () => ({
      ok: true,
      json: async () => ({ success: true, invitations: [] }),
    }),
    "POST /api/meetings/meeting-999/cancel": async () => {
      cancelled = true;
      return {
        ok: true,
        json: async () => ({
          success: true,
          meeting: { id: "meeting-999", status: "cancelled" },
        }),
      };
    },
  });

  renderDashboard("/dashboard/events");

  expect(await screen.findByText("Project Kickoff")).toBeInTheDocument();
  expect(screen.getByText("raj@example.com")).toBeInTheDocument();
  expect(screen.getByText("accepted")).toBeInTheDocument();

  const cancelMeetingBtn = screen.getByRole("button", { name: "Cancel meeting" });
  expect(cancelMeetingBtn).toBeInTheDocument();

  await userEvent.click(cancelMeetingBtn);

  await waitFor(() => {
    expect(screen.getByText("Meeting cancelled successfully")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

test("4. Invitee sees RSVP response buttons and no Edit/Delete buttons on attendee event", async () => {
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        events: [
          {
            id: "meeting-456",
            owner: "other-organizer",
            title: "Cross-team Sync",
            startAt: "2026-11-22T10:00:00.000Z",
            endAt: "2026-11-22T11:00:00.000Z",
            status: "active",
            organizer: {
              name: "External Lead",
              email: "lead@example.com",
            },
            participants: [
              {
                email: "ansh@example.com",
                status: "pending",
              },
            ],
          },
        ],
      }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "GET /api/meetings/invitations": async () => ({
      ok: true,
      json: async () => ({ success: true, invitations: [] }),
    }),
  });

  renderDashboard("/dashboard/events");

  expect(await screen.findByText("Cross-team Sync")).toBeInTheDocument();
  // Ensure Edit and Delete buttons are NOT shown for invitee
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
});

test("5. Allows confirming a shared meeting with participant and resource", async () => {
  let confirmed = false;

  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "GET /api/meetings/invitations": async () => ({
      ok: true,
      json: async () => ({ success: true, invitations: [] }),
    }),
    "GET /api/participants/search?q=sarah%40example.com&limit=10": async () => ({
      ok: true,
      json: async () => ({ success: true, participants: [] }),
    }),
    "POST /api/meetings/confirm": async (options) => {
      const body = JSON.parse(options.body);
      expect(body.title).toBe("Shared Architecture Review");
      expect(body.participantEmails).toContain("sarah@example.com");
      confirmed = true;
      return {
        ok: true,
        json: async () => ({
          success: true,
          meeting: {
            id: "meeting-101",
            owner: "user-123",
            title: "Shared Architecture Review",
            startAt: body.startAt,
            endAt: body.endAt,
            status: "active",
            participants: [
              {
                email: "sarah@example.com",
                status: "pending",
              },
            ],
          },
        }),
      };
    },
  });

  renderDashboard("/dashboard/events/new");

  await screen.findByText("No events yet");

  await userEvent.type(screen.getByLabelText("Title"), "Shared Architecture Review");
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2026-11-25T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2026-11-25T11:00" },
  });
  const picker = screen.getByRole("combobox", { name: "Invite registered users" });
  fireEvent.change(picker, { target: { value: "sarah@example.com" } });
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(
    await screen.findByRole("region", { name: "Selected participant chips" }),
  ).toHaveTextContent("sarah@example.com");

  const confirmBtn = await screen.findByRole("button", {
    name: "Confirm shared meeting",
  });
  expect(confirmBtn).toBeInTheDocument();

  await userEvent.click(confirmBtn);

  await waitFor(() => {
    expect(screen.getByText("Shared meeting confirmed successfully!")).toBeInTheDocument();
    expect(confirmed).toBe(true);
  });
});

test("6. Displays clear actionable error message when atomic booking returns 503 replica set required", async () => {
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "GET /api/meetings/invitations": async () => ({
      ok: true,
      json: async () => ({ success: true, invitations: [] }),
    }),
    "GET /api/participants/search?q=sarah%40example.com&limit=10": async () => ({
      ok: true,
      json: async () => ({ success: true, participants: [] }),
    }),
    "POST /api/meetings/confirm": async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        success: false,
        message: "Atomic scheduling requires a MongoDB replica set.",
      }),
    }),
  });

  renderDashboard("/dashboard/events/new");
  await screen.findByText("No events yet");

  await userEvent.type(screen.getByLabelText("Title"), "Strategy Session");
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2026-11-25T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2026-11-25T11:00" },
  });
  const picker = screen.getByRole("combobox", { name: "Invite registered users" });
  fireEvent.change(picker, { target: { value: "sarah@example.com" } });
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(
    await screen.findByRole("region", { name: "Selected participant chips" }),
  ).toHaveTextContent("sarah@example.com");

  const confirmBtn = await screen.findByRole("button", {
    name: "Confirm shared meeting",
  });
  await userEvent.click(confirmBtn);

  await waitFor(() => {
    expect(
      screen.getByText(/Atomic scheduling requires a MongoDB replica set/),
    ).toBeInTheDocument();
  });
});


