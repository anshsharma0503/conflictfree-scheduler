import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import RegisterPage from "./RegisterPage";

function renderRegisterPage() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
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

test("shows manual register form and Google login link", () => {
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

  renderRegisterPage();

  expect(
    screen.getByRole("heading", { name: "Create your ConflictFree account" }),
  ).toBeInTheDocument();

  expect(screen.getByLabelText("Name")).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
    "href",
    "http://localhost:5000/api/auth/google",
  );

  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("submits manual register and redirects to dashboard", async () => {
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

      if (path === "/api/auth/register") {
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

  renderRegisterPage();

  await userEvent.type(screen.getByLabelText("Name"), "Manual User");
  await userEvent.type(screen.getByLabelText("Email"), "manual@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "password123");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() => {
    expect(localStorage.getItem("conflictfree_auth_user")).toContain(
      "manual@example.com",
    );
  });

  expect(await screen.findByRole("heading", { name: "Dashboard Page" })).toBeInTheDocument();
});