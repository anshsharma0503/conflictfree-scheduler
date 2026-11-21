import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, test, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import HomePage from "./HomePage";

function renderHomePage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <HomePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockFetchWithHandlers(handlers) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      const handler = handlers[path];

      if (!handler) {
        throw new Error(`No fetch mock for ${path}`);
      }

      return handler(options);
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("shows backend health status when API is available", async () => {
  mockFetchWithHandlers({
    "/api/auth/me": async () => ({
      ok: false,
      json: async () => ({
        success: false,
        message: "Authentication required",
      }),
    }),
    "/api/health": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        message: "ConflictFree API is running",
      }),
    }),
  });

  renderHomePage();

  expect(screen.getByText("Checking API...")).toBeInTheDocument();

  expect(await screen.findByText("ConflictFree API is running")).toBeInTheDocument();

  expect(fetch).toHaveBeenCalledWith("/api/health", {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
});

test("shows API error message when API is unavailable", async () => {
  mockFetchWithHandlers({
    "/api/auth/me": async () => ({
      ok: false,
      json: async () => ({
        success: false,
        message: "Authentication required",
      }),
    }),
    "/api/health": async () => {
      throw new Error("Network error");
    },
  });

  renderHomePage();

  expect(await screen.findByText("Unable to connect to the API")).toBeInTheDocument();
});

test("shows sign in link when user is logged out", async () => {
  mockFetchWithHandlers({
    "/api/auth/me": async () => ({
      ok: false,
      json: async () => ({
        success: false,
        message: "Authentication required",
      }),
    }),
    "/api/health": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        message: "ConflictFree API is running",
      }),
    }),
  });

  renderHomePage();

  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("shows stored user, dashboard link, and logs out", async () => {
  localStorage.setItem(
    "conflictfree_auth_user",
    JSON.stringify({
      id: "user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
      avatarUrl: "https://example.com/avatar.png",
      timezone: "UTC",
    }),
  );

  mockFetchWithHandlers({
    "/api/auth/me": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        user: {
          id: "user-123",
          email: "ansh@example.com",
          name: "Ansh Sharma",
        },
      }),
    }),
    "/api/health": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        message: "ConflictFree API is running",
      }),
    }),
    "/api/auth/logout": async () => ({
      ok: true,
      json: async () => ({
        success: true,
        message: "Logged out successfully",
      }),
    }),
  });

  renderHomePage();

  expect(screen.getByText("Ansh Sharma")).toBeInTheDocument();
  expect(screen.getByText("ansh@example.com")).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "Open dashboard" })).toHaveAttribute(
    "href",
    "/dashboard",
  );

  await userEvent.click(screen.getByRole("button", { name: "Log out" }));

  await waitFor(() => {
    expect(localStorage.getItem("conflictfree_auth_user")).toBeNull();
  });

  expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
});