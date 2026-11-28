import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { renderDashboard } from "../test/renderDashboard";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "ansh@example.com", name: "Ansh Sharma", timezone: "UTC" },
    logoutUser: vi.fn(),
  }),
}));

const ok = (body) => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });
const fail = (status, message) => ({ ok: false, status, json: async () => ({ success: false, message }) });

function draft(overrides = {}) {
  return {
    title: "Design review",
    durationMinutes: 45,
    timezone: "UTC",
    windowStart: "2026-12-02T12:00:00.000Z",
    windowEnd: "2026-12-02T17:00:00.000Z",
    windowStartLocal: "2026-12-02T12:00",
    windowEndLocal: "2026-12-02T17:00",
    participants: [
      { query: "Priya", status: "matched", matches: [{ id: "u-priya", name: "Priya Shah", email: "priya@example.com" }] },
      {
        query: "Alex",
        status: "ambiguous",
        matches: [
          { id: "u-alex", name: "Alex Kumar", email: "alex@example.com" },
          { id: "u-alexandra", name: "Alexandra Lee", email: "alexandra@example.com" },
        ],
      },
      { query: "Zed", status: "not_found", matches: [] },
    ],
    preferences: { avoidLateDay: true },
    resource: { type: "room", attendeeCount: 4 },
    assumptions: ["Part of that time has already passed, so searching from now."],
    clarification: "",
    ...overrides,
  };
}

function mockApi({ enabled = true, parse = () => ok({ request: draft(), model: "gemini-test" }) } = {}) {
  const calls = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      const key = `${options.method || "GET"} ${path}`;
      calls.push({ key, body: options.body ? JSON.parse(options.body) : undefined });

      if (key === "GET /api/events") return ok({ events: [] });
      if (key === "GET /api/resources") return ok({ resources: [] });
      if (key === "GET /api/meetings/invitations") return ok({ invitations: [] });
      if (key.startsWith("GET /api/notifications")) return ok({ notifications: [], unreadCount: 0 });
      if (key === "GET /api/assistant/status") return ok({ assistant: { enabled, model: enabled ? "gemini-test" : null } });
      if (key === "POST /api/assistant/parse-request") return parse(JSON.parse(options.body));
      if (key === "POST /api/scheduling/suggestions") {
        return ok({
          suggestions: [{ startAt: "2026-12-02T13:00:00.000Z", endAt: "2026-12-02T13:45:00.000Z", score: 90, reasons: [] }],
          participants: [],
          relaxed: false,
          relaxationLevel: 0,
          relaxationSteps: [],
        });
      }

      throw new Error(`No fetch mock for ${key}`);
    }),
  );

  return calls;
}

async function describe(text) {
  const box = await screen.findByLabelText("Describe the meeting");
  await userEvent.type(box, text);
  await userEvent.click(screen.getByRole("button", { name: "Understand" }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("the assistant is hidden when the server has no Gemini key", async () => {
  mockApi({ enabled: false });
  renderDashboard("/dashboard/find-time");

  expect(await screen.findByRole("heading", { name: "Find a time" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByLabelText("Describe the meeting")).not.toBeInTheDocument());
});

test("Understand is disabled until there is enough text", async () => {
  mockApi();
  renderDashboard("/dashboard/find-time");

  const button = await screen.findByRole("button", { name: "Understand" });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Describe the meeting"), "hi");
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Describe the meeting"), " Priya");
  expect(button).toBeEnabled();
});

test("shows the interpretation: window, length, needs, people and assumptions", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard/find-time");

  await describe("Design review with Priya, Alex and Zed Tuesday afternoon, room for 4");

  expect(calls.find((c) => c.key === "POST /api/assistant/parse-request").body).toEqual({
    text: "Design review with Priya, Alex and Zed Tuesday afternoon, room for 4",
  });
  expect(await screen.findByText("Design review")).toBeInTheDocument();
  expect(screen.getByText("45 min")).toBeInTheDocument();
  expect(screen.getByText("not too late")).toBeInTheDocument();
  expect(screen.getByText("a room for 4")).toBeInTheDocument();
  expect(screen.getByText("Priya Shah")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Which “Alex”?" })).toBeInTheDocument();
  expect(screen.getByText(/No account for “Zed”/)).toBeInTheDocument();
  expect(screen.getByText("Part of that time has already passed, so searching from now.")).toBeInTheDocument();
  expect(screen.getByText(/Choose who you mean above/)).toBeInTheDocument();
});

test("Fill the form only copies the draft into the search form and the people picker", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard/find-time");
  await describe("Design review with Priya Tuesday afternoon");

  const alexGroup = await screen.findByRole("group", { name: "Which “Alex”?" });
  await userEvent.click(within(alexGroup).getByLabelText(/Alexandra Lee/));
  await userEvent.click(screen.getByRole("button", { name: "Fill the form only" }));

  expect(screen.getByLabelText("Window start")).toHaveValue("2026-12-02T12:00");
  expect(screen.getByLabelText("Window end")).toHaveValue("2026-12-02T17:00");
  expect(screen.getByLabelText("Duration (minutes)")).toHaveValue(45);
  expect(screen.getByLabelText("Automatically allocate a resource")).toBeChecked();
  expect(screen.getByLabelText("Required attendees")).toHaveValue(4);
  expect(screen.getByText("Filled in “Design review” from your description")).toBeInTheDocument();
  // Picked people appear as chips; nothing was searched yet.
  expect(screen.getAllByText("Priya Shah").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Alexandra Lee").length).toBeGreaterThan(0);
  expect(calls.some((c) => c.key === "POST /api/scheduling/suggestions")).toBe(false);
});

test("Search these times runs smart suggestions with exactly the parsed values", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard/find-time");
  await describe("Design review with Priya Tuesday afternoon");

  const alexGroup = await screen.findByRole("group", { name: "Which “Alex”?" });
  await userEvent.click(within(alexGroup).getByLabelText(/Alex Kumar/));
  await userEvent.click(screen.getByRole("button", { name: "Search these times" }));

  await waitFor(() => expect(calls.some((c) => c.key === "POST /api/scheduling/suggestions")).toBe(true));
  const body = calls.find((c) => c.key === "POST /api/scheduling/suggestions").body;
  expect(body.windowStart).toBe("2026-12-02T12:00:00.000Z");
  expect(body.windowEnd).toBe("2026-12-02T17:00:00.000Z");
  expect(body.durationMinutes).toBe(45);
  expect(body.participantEmails.sort()).toEqual(["alex@example.com", "priya@example.com"]);
  expect(body.preferences).toMatchObject({ avoidLateDay: true });
  expect(body.autoAllocateResource).toBe(true);
  expect(body.resourceType).toBe("room");
  expect(body.attendeeCount).toBe(4);
  expect(body.participantEmails).not.toContain("alexandra@example.com");
});

test("an unresolved ambiguous name is left out of the search", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard/find-time");
  await describe("Design review with Priya Tuesday afternoon");

  await userEvent.click(await screen.findByRole("button", { name: "Search these times" }));

  await waitFor(() => expect(calls.some((c) => c.key === "POST /api/scheduling/suggestions")).toBe(true));
  expect(calls.find((c) => c.key === "POST /api/scheduling/suggestions").body.participantEmails).toEqual([
    "priya@example.com",
  ]);
});

test("server errors are shown and the form is left untouched", async () => {
  mockApi({ parse: () => fail(503, "The assistant is busy right now. Try again in a moment, or fill in the form yourself.") });
  renderDashboard("/dashboard/find-time");

  await describe("lunch with Priya tomorrow");

  expect(await screen.findByRole("alert")).toHaveTextContent(/busy right now/);
  expect(screen.getByLabelText("Window start")).toHaveValue("");
});

test("Enter submits; Shift+Enter makes a new line", async () => {
  const calls = mockApi();
  renderDashboard("/dashboard/find-time");

  const box = await screen.findByLabelText("Describe the meeting");
  await userEvent.type(box, "sync with Priya{Shift>}{Enter}{/Shift}tomorrow");
  expect(calls.some((c) => c.key === "POST /api/assistant/parse-request")).toBe(false);

  await userEvent.type(box, "{Enter}");
  await waitFor(() =>
    expect(calls.find((c) => c.key === "POST /api/assistant/parse-request").body.text).toBe(
      "sync with Priya\ntomorrow",
    ),
  );
});
