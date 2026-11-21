import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import LoginPage from "./LoginPage";

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<h1>Dashboard Page</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("shows manual login form and Google login link", () => {
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

  renderLoginPage();

  expect(
    screen.getByRole("heading", { name: "Sign in to ConflictFree" }),
  ).toBeInTheDocument();

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
    "href",
    "http://localhost:5000/api/auth/google",
  );

  expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
    "href",
    "/register",
  );
});

test("submits manual login and redirects to dashboard", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      if (path === "/api/auth/me") {
        return {
          ok: false,
          json: async () => ({
            success: false,
            message: "Authentication required",
          }),
        };
      }

      if (path === "/api/auth/login") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            user: {
              id: "user-123",
              email: "manual@example.com",
              name: "Manual User",
              avatarUrl: null,
              timezone: "UTC",
            },
          }),
        };
      }

      throw new Error(`Unexpected request: ${path}`);
    }),
  );

  renderLoginPage();

  await userEvent.type(screen.getByLabelText("Email"), "manual@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "password123");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => {
    expect(localStorage.getItem("conflictfree_auth_user")).toContain(
      "manual@example.com",
    );
  });

  expect(await screen.findByRole("heading", { name: "Dashboard Page" })).toBeInTheDocument();
});
test("a slow failing initial session check does not log out a user who just signed in", async () => {
  let rejectInitialSessionCheck;

  vi.stubGlobal(
    "fetch",
    vi.fn((path) => {
      if (path === "/api/auth/me") {
        // Hold the initial session check open until after login succeeds.
        return new Promise((resolve) => {
          rejectInitialSessionCheck = () =>
            resolve({
              ok: false,
              json: async () => ({
                success: false,
                message: "Authentication required",
              }),
            });
        });
      }

      if (path === "/api/auth/login") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            user: {
              id: "user-race",
              email: "race@example.com",
              name: "Race User",
              avatarUrl: null,
              timezone: "UTC",
            },
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`));
    }),
  );

  renderLoginPage();

  await userEvent.type(screen.getByLabelText("Email"), "race@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "password123");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("heading", { name: "Dashboard Page" })).toBeInTheDocument();

  // The stale 401 from the initial check now arrives and is fully processed.
  await act(async () => {
    rejectInitialSessionCheck();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(localStorage.getItem("conflictfree_auth_user")).toContain("race@example.com");
  expect(screen.getByRole("heading", { name: "Dashboard Page" })).toBeInTheDocument();
});
