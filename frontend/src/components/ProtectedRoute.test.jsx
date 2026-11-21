import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import ProtectedRoute from "./ProtectedRoute";

function renderProtectedRoute(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<h1>Login Page</h1>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <h1>Dashboard Page</h1>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

test("redirects logged-out users to login", () => {
  renderProtectedRoute();

  expect(screen.getByText("Login Page")).toBeInTheDocument();
});

test("shows protected content for logged-in users", () => {
  localStorage.setItem(
    "conflictfree_auth_user",
    JSON.stringify({
      id: "user-123",
      email: "ansh@example.com",
      name: "Ansh Sharma",
    }),
  );

  renderProtectedRoute();

  expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
});