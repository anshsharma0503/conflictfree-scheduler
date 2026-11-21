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
            avatarUrl: null,
            timezone: "UTC",
        },
    }),
}));

function createEvent(overrides = {}) {
    return {
        id: "event-123",
        owner: "user-123",
        title: "Planning Meeting",
        description: "Discuss roadmap",
        startAt: "2026-08-20T10:00:00.000Z",
        endAt: "2026-08-20T11:00:00.000Z",
        timezone: "Asia/Kolkata",
        location: "Room 301",
        participants: [
            {
                email: "alex@example.com",
                name: "Alex",
                status: "pending",
            },
        ],
        source: "manual",
        googleEventId: null,
        ...overrides,
    };
}

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

function noConflictHandler() {
    return async () => ({
        ok: true,
        json: async () => ({
            success: true,
            hasConflict: false,
            conflicts: [],
        }),
    });
}

function conflictHandler(conflicts = []) {
    return async () => ({
        ok: true,
        json: async () => ({
            success: true,
            hasConflict: true,
            conflicts,
        }),
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
});

test("loads and displays events", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [createEvent()],
            }),
        }),
    });

    renderDashboard("/dashboard/events");

    expect(await screen.findByText("Planning Meeting")).toBeInTheDocument();
    expect(screen.getByText("Discuss roadmap")).toBeInTheDocument();
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
});

test("creates an event and adds it to the list", async () => {
    let createBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/conflicts": noConflictHandler(),
        "POST /api/events": async (options) => {
            createBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    event: createEvent({
                        title: "New Meeting",
                        description: "Created from test",
                        location: "Room 404",
                        participants: [],
                    }),
                }),
            };
        },
    });

    renderDashboard("/dashboard/events/new");

    await screen.findByText("No events yet");

    await userEvent.type(screen.getByLabelText("Title"), "New Meeting");
    await userEvent.type(screen.getByLabelText("Description"), "Created from test");

    fireEvent.change(screen.getByLabelText("Starts"), {
        target: {
            value: "2026-08-20T10:00",
        },
    });

    fireEvent.change(screen.getByLabelText("Ends"), {
        target: {
            value: "2026-08-20T11:00",
        },
    });

    await userEvent.type(screen.getByLabelText("Location"), "Room 404");
    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText("New Meeting")).toBeInTheDocument();
    expect(screen.getByText("Created from test")).toBeInTheDocument();
    // Personal events never send participants; the backend rejects them.
    expect(createBody).not.toHaveProperty("participants");
});

test("deletes an event from the list", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [createEvent()],
            }),
        }),
        "DELETE /api/events/event-123": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                message: "Event deleted successfully",
            }),
        }),
    });

    renderDashboard("/dashboard/events");

    expect(await screen.findByText("Planning Meeting")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
        expect(screen.queryByText("Planning Meeting")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Event deleted successfully")).toBeInTheDocument();
});

test("edits an event and updates it in the list", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [createEvent()],
            }),
        }),
        "POST /api/scheduling/conflicts": noConflictHandler(),
        "PATCH /api/events/event-123": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                event: createEvent({
                    title: "Updated Planning Meeting",
                    description: "Updated roadmap discussion",
                    location: "Room 909",
                }),
            }),
        }),
    });

    renderDashboard("/dashboard/events");

    expect(await screen.findByText("Planning Meeting")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Update calendar event" })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Updated Planning Meeting");

    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Updated roadmap discussion");

    await userEvent.clear(screen.getByLabelText("Location"));
    await userEvent.type(screen.getByLabelText("Location"), "Room 909");

    await userEvent.click(screen.getByRole("button", { name: "Update event" }));

    expect(await screen.findByText("Updated Planning Meeting")).toBeInTheDocument();
    expect(screen.getByText("Updated roadmap discussion")).toBeInTheDocument();
    expect(screen.getByText("Room 909")).toBeInTheDocument();
    expect(screen.getByText("Event updated successfully")).toBeInTheDocument();
});

test("create shows conflict warning and does not create the event when conflict exists", async () => {
    const conflictingEvent = createEvent({
        id: "event-existing",
        title: "Planning Meeting",
        startAt: "2026-08-20T10:00:00.000Z",
        endAt: "2026-08-20T11:00:00.000Z",
        location: "Room 301",
    });

    let createWasCalled = false;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [conflictingEvent],
            }),
        }),
        "POST /api/scheduling/conflicts": conflictHandler([
            {
                id: conflictingEvent.id,
                title: conflictingEvent.title,
                startAt: conflictingEvent.startAt,
                endAt: conflictingEvent.endAt,
                location: conflictingEvent.location,
            },
        ]),
        "POST /api/events": async () => {
            createWasCalled = true;
            return {
                ok: true,
                json: async () => ({ success: true, event: createEvent() }),
            };
        },
    });

    renderDashboard("/dashboard/events/new");

    await screen.findByText("1 event(s) loaded");

    await userEvent.type(screen.getByLabelText("Title"), "New Overlapping Meeting");

    fireEvent.change(screen.getByLabelText("Starts"), {
        target: { value: "2026-08-20T10:30" },
    });

    fireEvent.change(screen.getByLabelText("Ends"), {
        target: { value: "2026-08-20T11:30" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByRole("alert", { name: "Conflict warning" })).toBeInTheDocument();
    expect(screen.getByText("Scheduling conflict detected")).toBeInTheDocument();

    const conflictPanel = screen.getByRole("alert", { name: "Conflict warning" });
    expect(conflictPanel).toHaveTextContent("Planning Meeting");

    expect(createWasCalled).toBe(false);
});

test("edit passes excludeEventId to conflict check so the event does not conflict with itself", async () => {
    const existingEvent = createEvent();
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [existingEvent],
            }),
        }),
        "POST /api/scheduling/conflicts": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    hasConflict: false,
                    conflicts: [],
                }),
            };
        },
        "PATCH /api/events/event-123": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                event: existingEvent,
            }),
        }),
    });

    renderDashboard("/dashboard/events");

    expect(await screen.findByText("Planning Meeting")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Update calendar event" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Update event" }));

    // Conflict check must have been called with the correct excludeEventId
    await waitFor(() => {
        expect(capturedBody).not.toBeNull();
    });

    expect(capturedBody.excludeEventId).toBe("event-123");
});

test("successful create works when conflict check returns no conflict", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/conflicts": noConflictHandler(),
        "POST /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                event: createEvent({
                    title: "Conflict-Free Meeting",
                    startAt: "2026-08-21T14:00:00.000Z",
                    endAt: "2026-08-21T15:00:00.000Z",
                }),
            }),
        }),
    });

    renderDashboard("/dashboard/events/new");

    await screen.findByText("No events yet");

    await userEvent.type(screen.getByLabelText("Title"), "Conflict-Free Meeting");

    fireEvent.change(screen.getByLabelText("Starts"), {
        target: { value: "2026-08-21T14:00" },
    });

    fireEvent.change(screen.getByLabelText("Ends"), {
        target: { value: "2026-08-21T15:00" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText("Conflict-Free Meeting")).toBeInTheDocument();
    expect(screen.getByText("Event created successfully")).toBeInTheDocument();

    expect(screen.queryByRole("alert", { name: "Conflict warning" })).not.toBeInTheDocument();
});

test("finds and displays available slots", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async (options) => {
            const body = JSON.parse(options.body);
            expect(body.durationMinutes).toBe(60);
            expect(body.slotStepMinutes).toBe(30);

            return {
                ok: true,
                json: async () => ({
                    success: true,
                    slots: [
                        {
                            startAt: "2026-08-25T09:00:00.000Z",
                            endAt: "2026-08-25T10:00:00.000Z",
                        },
                        {
                            startAt: "2026-08-25T11:00:00.000Z",
                            endAt: "2026-08-25T12:00:00.000Z",
                        },
                    ],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });

    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T13:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    expect(
        await screen.findByRole("region", { name: "Available slots" }),
    ).toBeInTheDocument();

    const slotButtons = screen.getAllByRole("button", { name: /Select/i });
    expect(slotButtons).toHaveLength(2);
});

test("clicking an available slot fills start and end fields in the event form", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                slots: [
                    {
                        startAt: "2026-08-25T11:00:00.000Z",
                        endAt: "2026-08-25T12:00:00.000Z",
                    },
                ],
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });

    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T13:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    const slotButton = await screen.findByRole("button", { name: /Select/i });
    await userEvent.click(slotButton);

    const startsInput = screen.getByLabelText("Starts");
    const endsInput = screen.getByLabelText("Ends");

    expect(startsInput.value).not.toBe("");
    expect(endsInput.value).not.toBe("");
});

test("shows empty state when no slots are returned", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                slots: [],
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });

    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T10:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    expect(
        await screen.findByText("No available slots found"),
    ).toBeInTheDocument();
});

test("displays error when slot search API fails", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async () => ({
            ok: false,
            status: 400,
            json: async () => ({
                success: false,
                message: "windowEnd must be after windowStart",
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T12:00" },
    });

    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T09:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    expect(
        await screen.findByText("windowEnd must be after windowStart"),
    ).toBeInTheDocument();
});

test("submits slot preferences and displays score badges with reasons", async () => {
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    slots: [
                        {
                            startAt: "2026-08-25T14:00:00.000Z",
                            endAt: "2026-08-25T15:00:00.000Z",
                            score: 90,
                            reasons: ["Within preferred hours", "Avoids early morning", "Avoids late day", "Earliest slot bonus (+10)"],
                        },
                        {
                            startAt: "2026-08-25T09:00:00.000Z",
                            endAt: "2026-08-25T10:00:00.000Z",
                            score: 43,
                            reasons: ["Outside preferred hours", "Early morning slot penalty", "Avoids late day", "Earliest slot bonus (+8)"],
                        },
                    ],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });

    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });

    fireEvent.change(screen.getByLabelText("Preferred start hour"), {
        target: { value: "14" },
    });
    fireEvent.change(screen.getByLabelText("Preferred end hour"), {
        target: { value: "17" },
    });
    await userEvent.click(screen.getByLabelText(/Avoid early morning/i));
    await userEvent.click(screen.getByLabelText(/Avoid late day/i));
    await userEvent.click(screen.getByLabelText(/Earliest slot bonus/i));

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    await waitFor(() => {
        expect(capturedBody).not.toBeNull();
    });
    expect(capturedBody.preferences).toEqual({
        preferredStartHour: 14,
        preferredEndHour: 17,
        avoidEarlyMorning: true,
        avoidLateDay: true,
        earliestSlotBonus: true,
        timezone: "UTC",
    });

    expect(await screen.findByText("Score: 90")).toBeInTheDocument();
    expect(screen.getByText("Score: 43")).toBeInTheDocument();
    expect(screen.getByText("Within preferred hours")).toBeInTheDocument();
    expect(screen.getByText("Early morning slot penalty")).toBeInTheDocument();
});

test("submits smart suggestions request with minimumScore and maxSuggestions and displays suggestion cards", async () => {
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/suggestions": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    suggestions: [
                        {
                            startAt: "2026-08-25T14:00:00.000Z",
                            endAt: "2026-08-25T15:00:00.000Z",
                            score: 85,
                            reasons: ["Inside preferred time window"],
                            relaxedConstraints: [],
                        },
                    ],
                    relaxed: false,
                    relaxationLevel: 0,
                    relaxationSteps: [{ level: 0, label: "Strict constraints", relaxedConstraints: [] }],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });
    fireEvent.change(screen.getByLabelText("Minimum score"), {
        target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Max suggestions"), {
        target: { value: "3" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find smart suggestions" }),
    );

    await waitFor(() => {
        expect(capturedBody).not.toBeNull();
    });
    expect(capturedBody.minimumScore).toBe(70);
    expect(capturedBody.maxSuggestions).toBe(3);

    expect(await screen.findByText("Smart Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Score: 85")).toBeInTheDocument();
    expect(screen.getByText("Inside preferred time window")).toBeInTheDocument();
});

test("displays relaxation notice when suggestions are relaxed", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/suggestions": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                suggestions: [
                    {
                        startAt: "2026-08-25T09:00:00.000Z",
                        endAt: "2026-08-25T10:00:00.000Z",
                        score: 50,
                        reasons: [],
                        relaxedConstraints: ["preferredTimeWindow"],
                    },
                ],
                relaxed: true,
                relaxationLevel: 1,
                relaxationSteps: [
                    { level: 0, label: "Strict constraints", relaxedConstraints: [] },
                    { level: 1, label: "Relaxed preferred time window", relaxedConstraints: ["preferredTimeWindow"] },
                ],
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find smart suggestions" }),
    );

    expect(await screen.findByRole("note", { name: "Relaxation notice" })).toBeInTheDocument();
    expect(screen.getByText("No strict match found. Constraints relaxed:")).toBeInTheDocument();
    expect(screen.getByText("Relaxed preferred time window")).toBeInTheDocument();
    expect(screen.getByText("preferredTimeWindow")).toBeInTheDocument();
});

test("clicking suggestion card populates event form start and end fields", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/suggestions": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                suggestions: [
                    {
                        startAt: "2026-08-25T14:00:00.000Z",
                        endAt: "2026-08-25T15:00:00.000Z",
                        score: 80,
                        reasons: [],
                        relaxedConstraints: [],
                    },
                ],
                relaxed: false,
                relaxationLevel: 0,
                relaxationSteps: [{ level: 0, label: "Strict constraints", relaxedConstraints: [] }],
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find smart suggestions" }),
    );

    const selectButton = await screen.findByRole("button", {
        name: /Score: 80/i,
    });
    await userEvent.click(selectButton);

    expect(screen.getByLabelText("Starts").value).toBe("2026-08-25T14:00");
    expect(screen.getByLabelText("Ends").value).toBe("2026-08-25T15:00");
});

test("displays error when smart suggestions API fails", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/suggestions": async () => ({
            ok: false,
            status: 400,
            json: async () => ({
                success: false,
                message: "minimumScore must be between 0 and 100",
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });

    await userEvent.click(
        screen.getByRole("button", { name: "Find smart suggestions" }),
    );

    expect(
        await screen.findByText("minimumScore must be between 0 and 100"),
    ).toBeInTheDocument();
});

test("submits participantEmails in available-slots search payload and displays coordinated participants summary", async () => {
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    participants: [
                        { id: "user-123", name: "Ansh Sharma", email: "ansh@example.com", timezone: "UTC" },
                        { id: "part-1", name: "Raj Patel", email: "raj@example.com", timezone: "Asia/Kolkata" },
                    ],
                    slots: [
                        {
                            startAt: "2026-08-25T11:00:00.000Z",
                            endAt: "2026-08-25T12:00:00.000Z",
                            score: 85,
                            reasons: ["Avoids early morning"],
                        },
                    ],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });
    fireEvent.change(
        screen.getByLabelText(/Participant user emails \(comma-separated registered users\)/i),
        {
            target: { value: "raj@example.com, ansh@example.com" },
        },
    );

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.participantEmails).toEqual(["raj@example.com", "ansh@example.com"]);

    const summaryRegion = await screen.findByRole("region", {
        name: "Coordinated participants",
    });
    expect(summaryRegion).toBeInTheDocument();
    expect(screen.getByText("Coordinated Participants")).toBeInTheDocument();
    expect(screen.getByText("2 users")).toBeInTheDocument();
    expect(screen.getByText("Raj Patel")).toBeInTheDocument();
    expect(screen.getByText("raj@example.com")).toBeInTheDocument();
    expect(screen.getByText("Asia/Kolkata")).toBeInTheDocument();

    const selectButton = await screen.findByRole("button", {
        name: /Score: 85/i,
    });
    await userEvent.click(selectButton);

    expect(screen.getByLabelText("Starts").value).toBe("2026-08-25T11:00");
    expect(screen.getByLabelText("Ends").value).toBe("2026-08-25T12:00");
});

test("displays error when available-slots search returns unknown participant validation error", async () => {
    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/available-slots": async () => ({
            ok: false,
            status: 400,
            json: async () => ({
                success: false,
                message: "User not found for participant email: unknown@example.com",
            }),
        }),
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });
    fireEvent.change(
        screen.getByLabelText(/Participant user emails \(comma-separated registered users\)/i),
        {
            target: { value: "unknown@example.com" },
        },
    );

    await userEvent.click(
        screen.getByRole("button", { name: "Find available slots" }),
    );

    expect(
        await screen.findByText("User not found for participant email: unknown@example.com"),
    ).toBeInTheDocument();
});

test("submits participantEmails in smart suggestions payload and displays coordinated participants", async () => {
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "POST /api/scheduling/suggestions": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    participants: [
                        { id: "user-123", name: "Ansh Sharma", email: "ansh@example.com", timezone: "UTC" },
                        { id: "part-2", name: "Sarah Connor", email: "sarah@example.com", timezone: "America/New_York" },
                    ],
                    suggestions: [
                        {
                            startAt: "2026-08-25T14:00:00.000Z",
                            endAt: "2026-08-25T15:00:00.000Z",
                            score: 90,
                            reasons: [],
                            relaxedConstraints: [],
                        },
                    ],
                    relaxed: false,
                    relaxationLevel: 0,
                    relaxationSteps: [],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");

    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });
    fireEvent.change(
        screen.getByLabelText(/Participant user emails \(comma-separated registered users\)/i),
        {
            target: { value: "sarah@example.com" },
        },
    );

    await userEvent.click(
        screen.getByRole("button", { name: "Find smart suggestions" }),
    );

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.participantEmails).toEqual(["sarah@example.com"]);

    const summaryRegion = await screen.findByRole("region", {
        name: "Coordinated participants",
    });
    expect(summaryRegion).toBeInTheDocument();
    expect(screen.getByText("Sarah Connor")).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
});

test("selecting a participant via autocomplete sends participantEmails to available-slots search", async () => {
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "GET /api/participants/search?q=raj&limit=10": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                participants: [
                    {
                        id: "part-1",
                        name: "Raj Patel",
                        email: "raj@example.com",
                        timezone: "Asia/Kolkata",
                    },
                ],
            }),
        }),
        "POST /api/scheduling/available-slots": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    participants: [
                        { id: "user-123", name: "Ansh Sharma", email: "ansh@example.com", timezone: "UTC" },
                        { id: "part-1", name: "Raj Patel", email: "raj@example.com", timezone: "Asia/Kolkata" },
                    ],
                    slots: [
                        {
                            startAt: "2026-08-25T11:00:00.000Z",
                            endAt: "2026-08-25T12:00:00.000Z",
                            score: 85,
                            reasons: ["Avoids early morning"],
                        },
                    ],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");
    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });

    // Type in autocomplete search
    const combobox = screen.getByRole("combobox", { name: /Participant user emails/i });
    fireEvent.change(combobox, { target: { value: "raj" } });

    // Click suggestion
    const suggestion = await screen.findByRole("option", { name: /Raj Patel/i });
    fireEvent.click(suggestion);

    // Verify chip added
    expect(screen.getByRole("region", { name: "Selected participant chips" })).toBeInTheDocument();

    // Click Find available slots
    await userEvent.click(screen.getByRole("button", { name: "Find available slots" }));

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.participantEmails).toEqual(["raj@example.com"]);
});

test("selecting a participant via autocomplete sends participantEmails to smart suggestions", async () => {
    let capturedBody = null;

    mockFetchWithHandlers({
        "GET /api/events": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                events: [],
            }),
        }),
        "GET /api/participants/search?q=sarah&limit=10": async () => ({
            ok: true,
            json: async () => ({
                success: true,
                participants: [
                    {
                        id: "part-2",
                        name: "Sarah Connor",
                        email: "sarah@example.com",
                        timezone: "America/New_York",
                    },
                ],
            }),
        }),
        "POST /api/scheduling/suggestions": async (options) => {
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    participants: [
                        { id: "user-123", name: "Ansh Sharma", email: "ansh@example.com", timezone: "UTC" },
                        { id: "part-2", name: "Sarah Connor", email: "sarah@example.com", timezone: "America/New_York" },
                    ],
                    suggestions: [
                        {
                            startAt: "2026-08-25T14:00:00.000Z",
                            endAt: "2026-08-25T15:00:00.000Z",
                            score: 90,
                            reasons: [],
                            relaxedConstraints: [],
                        },
                    ],
                    relaxed: false,
                    relaxationLevel: 0,
                    relaxationSteps: [],
                }),
            };
        },
    });

    renderDashboard("/dashboard/find-time");
    await screen.findByText("No events yet");

    fireEvent.change(screen.getByLabelText("Window start"), {
        target: { value: "2026-08-25T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
        target: { value: "2026-08-25T18:00" },
    });

    // Type in autocomplete search
    const combobox = screen.getByRole("combobox", { name: /Participant user emails/i });
    fireEvent.change(combobox, { target: { value: "sarah" } });

    // Click suggestion
    const suggestion = await screen.findByRole("option", { name: /Sarah Connor/i });
    fireEvent.click(suggestion);

    // Verify chip added
    expect(screen.getByRole("region", { name: "Selected participant chips" })).toBeInTheDocument();

    // Click Find smart suggestions
    await userEvent.click(screen.getByRole("button", { name: "Find smart suggestions" }));

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.participantEmails).toEqual(["sarah@example.com"]);
});