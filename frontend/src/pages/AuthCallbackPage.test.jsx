import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import AuthCallbackPage from "./AuthCallbackPage";

function renderAuthCallbackPage(initialPath) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      json: async () => ({
        success: false,
        message: "Authentication required",
      }),
    })),
  );

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<h1>Home Page</h1>} />
          <Route path="/login" element={<h1>Login Page</h1>} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("saves user, then redirects home", async () => {
  const user = {
    id: "user-123",
    email: "ansh@example.com",
    name: "Ansh Sharma",
    avatarUrl: "https://example.com/avatar.png",
    timezone: "UTC",
  };

  const userParam = encodeURIComponent(JSON.stringify(user));

  renderAuthCallbackPage(`/auth/callback?user=${userParam}`);

  await waitFor(() => {
    expect(localStorage.getItem("conflictfree_auth_user")).toBe(JSON.stringify(user));
  });

  expect(screen.getByText("Home Page")).toBeInTheDocument();
});

test("shows backend auth error", () => {
  renderAuthCallbackPage("/auth/callback?error=access_denied");

  expect(screen.getByRole("heading", { name: "Login failed" })).toBeInTheDocument();
  expect(screen.getByText("access_denied")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("shows error when user is missing", () => {
  renderAuthCallbackPage("/auth/callback");

  expect(screen.getByRole("heading", { name: "Login failed" })).toBeInTheDocument();
  expect(
    screen.getByText("Authentication response is missing user data"),
  ).toBeInTheDocument();
});