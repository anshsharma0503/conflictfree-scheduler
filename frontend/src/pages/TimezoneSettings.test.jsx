import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import DashboardApp from "./dashboard/DashboardApp";
import RegisterPage from "./RegisterPage";

const ok = (body) => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });
const browser = vi.hoisted(() => ({ timezone: "UTC" }));

vi.mock("../services/authService", async (importOriginal) => ({
  ...(await importOriginal()),
  getBrowserTimezone: () => browser.timezone,
}));

function useBrowserTimezone(timeZone) {
  browser.timezone = timeZone;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard/*" element={<DashboardApp />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("registration sends the browser's time zone", async () => {
  // registerUser reads the real Intl zone (same-module call, not mocked).
  const expectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const bodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      if (path === "/api/auth/register") {
        bodies.push(JSON.parse(options.body));
        return ok({ user: { id: "u1", name: "Ansh", email: "a@example.com", timezone: "Asia/Kolkata" } });
      }
      return { ok: false, status: 401, json: async () => ({ message: "Authentication required" }) };
    }),
  );

  renderAt("/register");
  await userEvent.type(screen.getByLabelText("Name"), "Ansh");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "password123");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].timezone).toBe(expectedZone);
  expect(expectedZone).toBeTruthy();
});

test("a UTC account in an IST browser can switch with one click", async () => {
  useBrowserTimezone("Asia/Kolkata");
  localStorage.setItem(
    "conflictfree_auth_user",
    JSON.stringify({ id: "u1", name: "Ansh", email: "a@example.com", timezone: "UTC" }),
  );
  let account = { id: "u1", name: "Ansh", email: "a@example.com", timezone: "UTC" };
  const patches = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options = {}) => {
      const key = `${options.method || "GET"} ${path}`;
      if (key === "GET /api/auth/me") return ok({ user: account });
      if (key === "PATCH /api/auth/me") {
        patches.push(JSON.parse(options.body));
        account = { ...account, timezone: JSON.parse(options.body).timezone };
        return ok({ user: account });
      }
      if (key === "GET /api/events") return ok({ events: [] });
      if (key === "GET /api/resources") return ok({ resources: [] });
      if (key === "GET /api/meetings/invitations") return ok({ invitations: [] });
      if (key.startsWith("GET /api/notifications")) return ok({ notifications: [], unreadCount: 0 });
      if (key === "GET /api/assistant/status") return ok({ assistant: { enabled: false } });
      throw new Error(`No fetch mock for ${key}`);
    }),
  );

  renderAt("/dashboard/events/new");

  const button = await screen.findByRole("button", { name: "Use Asia/Kolkata" });
  await userEvent.click(button);

  await waitFor(() => expect(patches).toEqual([{ timezone: "Asia/Kolkata" }]));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Use Asia/Kolkata" })).not.toBeInTheDocument(),
  );
  expect(screen.getAllByText("Asia/Kolkata").length).toBeGreaterThan(0);
  // The composer's zone follows the account.
  expect(screen.getByDisplayValue("Asia/Kolkata")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("conflictfree_auth_user")).timezone).toBe("Asia/Kolkata");
});

test("no switch button when the account already matches the browser", async () => {
  useBrowserTimezone("UTC");
  localStorage.setItem(
    "conflictfree_auth_user",
    JSON.stringify({ id: "u1", name: "Ansh", email: "a@example.com", timezone: "UTC" }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      if (path === "/api/auth/me") return ok({ user: { id: "u1", name: "Ansh", email: "a@example.com", timezone: "UTC" } });
      if (path === "/api/events") return ok({ events: [] });
      return ok({ resources: [], invitations: [], notifications: [], unreadCount: 0, assistant: { enabled: false } });
    }),
  );

  renderAt("/dashboard");

  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Use / })).not.toBeInTheDocument();
});
