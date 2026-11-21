import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { renderDashboard } from "../test/renderDashboard";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-123",
      email: "organizer@example.com",
      name: "Organizer User",
      avatarUrl: null,
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

const sampleResource = {
  id: "res-1",
  name: "Conference Room A",
  type: "room",
  capacity: 8,
  location: "Floor 2",
  description: "Has projector and whiteboard",
  isActive: true,
  createdBy: "user-123",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

test("loads and displays active resources", async () => {
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [sampleResource] }),
    }),
  });

  renderDashboard("/dashboard/resources");

  expect(await screen.findByText("Conference Room A")).toBeInTheDocument();
  expect(screen.getByText("Capacity: 8")).toBeInTheDocument();
  expect(screen.getByText("• Floor 2")).toBeInTheDocument();
  expect(screen.getByText("Has projector and whiteboard")).toBeInTheDocument();
  // Since user-123 is owner, Edit and Deactivate buttons should be visible
  expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
});

test("creates a new resource and adds it to the list", async () => {
  let capturedBody = null;
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "POST /api/resources": async (options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          resource: {
            id: "res-new",
            name: capturedBody.name,
            type: capturedBody.type,
            capacity: capturedBody.capacity,
            location: capturedBody.location,
            description: capturedBody.description,
            isActive: true,
            createdBy: "user-123",
          },
        }),
      };
    },
  });

  renderDashboard("/dashboard/resources");
  await screen.findByText("No events yet");

  await userEvent.type(screen.getByLabelText("Resource name"), "Pod 101");
  await userEvent.clear(screen.getByLabelText("Capacity"));
  await userEvent.type(screen.getByLabelText("Capacity"), "4");
  await userEvent.type(screen.getByLabelText("Resource venue"), "Wing B");
  await userEvent.type(screen.getByLabelText("Resource details"), "Quiet room");

  await userEvent.click(screen.getByRole("button", { name: "Create resource" }));

  expect(await screen.findByText("Pod 101")).toBeInTheDocument();
  expect(capturedBody).toEqual({
    name: "Pod 101",
    type: "room",
    capacity: 4,
    location: "Wing B",
    description: "Quiet room",
  });
});

test("soft-deactivates a resource and removes it from the list", async () => {
  let deactivatedId = null;
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [sampleResource] }),
    }),
    "DELETE /api/resources/res-1": async () => {
      deactivatedId = "res-1";
      return {
        ok: true,
        json: async () => ({ success: true, message: "Resource deactivated successfully" }),
      };
    },
  });

  renderDashboard("/dashboard/resources");
  expect(await screen.findByText("Conference Room A")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));

  await waitFor(() => {
    expect(screen.queryByText("Conference Room A")).not.toBeInTheDocument();
  });
  expect(deactivatedId).toBe("res-1");
});

test("submits event with selected resource and displays 409 conflict error when busy", async () => {
  let eventPayload = null;
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [sampleResource] }),
    }),
    "POST /api/scheduling/conflicts": async () => ({
      ok: true,
      json: async () => ({ success: true, hasConflict: false, conflicts: [] }),
    }),
    "POST /api/events": async (options) => {
      eventPayload = JSON.parse(options.body);
      return {
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          message: "Resource is already booked for the requested time",
        }),
      };
    },
  });

  renderDashboard("/dashboard/events/new");
  expect(await screen.findByRole("option", { name: "Conference Room A (room, cap: 8)" })).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Title"), "Team Sync");
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2026-09-01T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2026-09-01T11:00" },
  });
  fireEvent.change(screen.getByLabelText("Book resource"), {
    target: { value: "res-1" },
  });
  await userEvent.type(screen.getByLabelText("Expected attendees"), "5");

  await userEvent.click(screen.getByRole("button", { name: "Create event" }));

  expect(
    await screen.findByText("Resource is already booked for the requested time"),
  ).toBeInTheDocument();
  expect(eventPayload.resourceId).toBe("res-1");
  expect(eventPayload.attendeeCount).toBe(5);
});

test("finds available slots with resource and displays resource badge", async () => {
  let searchPayload = null;
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [sampleResource] }),
    }),
    "POST /api/scheduling/available-slots": async (options) => {
      searchPayload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          slots: [
            {
              startAt: "2026-09-01T14:00:00.000Z",
              endAt: "2026-09-01T15:00:00.000Z",
              score: 95,
              reasons: ["Resource available"],
            },
          ],
          participants: [
            {
              id: "user-123",
              email: "organizer@example.com",
              name: "Organizer User",
              timezone: "UTC",
            },
          ],
          resource: {
            id: "res-1",
            name: "Conference Room A",
            type: "room",
            capacity: 8,
          },
        }),
      };
    },
  });

  renderDashboard("/dashboard/find-time");
  expect(await screen.findByRole("option", { name: "Conference Room A (room, cap: 8)" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Window start"), {
    target: { value: "2026-09-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Window end"), {
    target: { value: "2026-09-01T18:00" },
  });
  fireEvent.change(screen.getByLabelText("Required resource (Optional)"), {
    target: { value: "res-1" },
  });
  fireEvent.change(screen.getByLabelText("Required attendees"), {
    target: { value: "6" },
  });

  await userEvent.click(screen.getByRole("button", { name: "Find available slots" }));

  expect(await screen.findByText(/Resource:/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Selected slot resource" })).toHaveTextContent(
    "Conference Room A (room, cap: 8)",
  );
  expect(searchPayload.resourceId).toBe("res-1");
  expect(searchPayload.attendeeCount).toBe(6);

  // Clicking the slot should fill start/end in the event form and set resource
  await userEvent.click(screen.getByRole("button", { name: /Select/i }));
  expect(screen.getByLabelText("Starts").value).toBe("2026-09-01T14:00");
  expect(screen.getByLabelText("Ends").value).toBe("2026-09-01T15:00");
  expect(screen.getByLabelText("Book resource").value).toBe("res-1");
});

test("auto-allocate checkbox disables manual resource select and sends autoAllocateResource", async () => {
  let searchPayload = null;
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [sampleResource] }),
    }),
    "POST /api/scheduling/available-slots": async (options) => {
      searchPayload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          slots: [
            {
              startAt: "2026-09-01T14:00:00.000Z",
              endAt: "2026-09-01T15:00:00.000Z",
              score: 90,
              reasons: ["Resource auto-allocated"],
              allocatedResource: {
                id: "res-auto",
                name: "Beta Room",
                type: "room",
                capacity: 10,
                location: "Floor 3",
              },
              allocationReason: "Beta Room is active, fits 5 attendees, and has no overlapping booking",
            },
          ],
          participants: [],
          resource: null,
        }),
      };
    },
  });

  renderDashboard("/dashboard/find-time");
  expect(await screen.findByRole("option", { name: "Conference Room A (room, cap: 8)" })).toBeInTheDocument();

  // Check auto-allocate checkbox
  const autoAllocateCheckbox = screen.getByLabelText("Automatically allocate a resource");
  await userEvent.click(autoAllocateCheckbox);
  expect(autoAllocateCheckbox).toBeChecked();

  // Manual resource select should be disabled
  expect(screen.getByLabelText("Required resource (Optional)")).toBeDisabled();

  // Resource type dropdown should appear
  expect(screen.getByLabelText("Resource type preference")).toBeInTheDocument();

  // Fill required fields and search
  fireEvent.change(screen.getByLabelText("Window start"), {
    target: { value: "2026-09-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Window end"), {
    target: { value: "2026-09-01T18:00" },
  });
  fireEvent.change(screen.getByLabelText("Required attendees"), {
    target: { value: "5" },
  });

  await userEvent.click(screen.getByRole("button", { name: "Find available slots" }));

  await waitFor(() => {
    expect(searchPayload).not.toBeNull();
  });

  expect(searchPayload.autoAllocateResource).toBe(true);
  expect(searchPayload.attendeeCount).toBe(5);
  expect(searchPayload.resourceId).toBeUndefined();

  // Allocated resource badge should render
  expect(await screen.findByText(/Allocated: Beta Room/)).toBeInTheDocument();
  expect(screen.getByText(/Beta Room is active, fits 5 attendees/)).toBeInTheDocument();

  // Click the slot and verify the form gets populated with allocated resource
  await userEvent.click(screen.getByRole("button", { name: /Select/i }));
  expect(screen.getByLabelText("Book resource").value).toBe("res-auto");
});

test("auto-allocate sends resourceType when selected", async () => {
  let searchPayload = null;
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [] }),
    }),
    "POST /api/scheduling/suggestions": async (options) => {
      searchPayload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          suggestions: [
            {
              startAt: "2026-09-01T10:00:00.000Z",
              endAt: "2026-09-01T11:00:00.000Z",
              score: 85,
              reasons: ["Good time"],
              allocatedResource: {
                id: "res-equip",
                name: "Projector A",
                type: "equipment",
                capacity: 1,
                location: "Storage",
              },
              allocationReason: "Projector A is active and available",
            },
          ],
          relaxed: false,
          relaxationLevel: 0,
          relaxationSteps: [],
          participants: [],
          resource: null,
        }),
      };
    },
  });

  renderDashboard("/dashboard/find-time");
  await screen.findByText("No events yet");

  // Enable auto-allocate
  await userEvent.click(screen.getByLabelText("Automatically allocate a resource"));

  // Select equipment type
  fireEvent.change(screen.getByLabelText("Resource type preference"), {
    target: { value: "equipment" },
  });

  fireEvent.change(screen.getByLabelText("Window start"), {
    target: { value: "2026-09-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Window end"), {
    target: { value: "2026-09-01T18:00" },
  });

  await userEvent.click(screen.getByRole("button", { name: "Find smart suggestions" }));

  await waitFor(() => {
    expect(searchPayload).not.toBeNull();
  });

  expect(searchPayload.autoAllocateResource).toBe(true);
  expect(searchPayload.resourceType).toBe("equipment");

  // Suggestion with allocated resource should render
  expect(await screen.findByText(/Allocated: Projector A/)).toBeInTheDocument();
  expect(screen.getByText(/Projector A is active and available/)).toBeInTheDocument();

  // Click the suggestion to fill the form with allocated resource
  await userEvent.click(screen.getByRole("button", { name: /Select/i }));
  expect(screen.getByLabelText("Book resource").value).toBe("res-equip");
});

test("shows client-side error when both manual resource and auto-allocate are selected", async () => {
  mockFetchWithHandlers({
    "GET /api/events": async () => ({
      ok: true,
      json: async () => ({ success: true, events: [] }),
    }),
    "GET /api/resources": async () => ({
      ok: true,
      json: async () => ({ success: true, resources: [sampleResource] }),
    }),
  });

  renderDashboard("/dashboard/find-time");
  await screen.findByText("No events yet");

  // Select a manual resource first
  fireEvent.change(screen.getByLabelText("Required resource (Optional)"), {
    target: { value: "res-1" },
  });

  // Now enable auto-allocate - this should clear the manual resource
  await userEvent.click(screen.getByLabelText("Automatically allocate a resource"));

  // Manual resource should be cleared and disabled
  expect(screen.getByLabelText("Required resource (Optional)")).toBeDisabled();
  expect(screen.getByLabelText("Required resource (Optional)").value).toBe("");
});
