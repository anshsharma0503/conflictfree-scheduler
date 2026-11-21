import apiRequest from "./apiClient";

const AUTH_USER_KEY = "conflictfree_auth_user";

export function getGoogleLoginUrl() {
  return "http://localhost:5000/api/auth/google";
}

export function saveStoredUser(user) {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function getStoredUser() {
  const storedUser = localStorage.getItem(AUTH_USER_KEY);

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch {
    localStorage.removeItem(AUTH_USER_KEY);
    return null;
  }
}

export function clearStoredUser() {
  localStorage.removeItem(AUTH_USER_KEY);
}

export async function registerUser({ name, email, password }) {
  const response = await apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password,
    }),
  });

  saveStoredUser(response.user);

  return response.user;
}

export async function loginUser({ email, password }) {
  const response = await apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  saveStoredUser(response.user);

  return response.user;
}

export async function getCurrentUser() {
  const response = await apiRequest("/api/auth/me");

  saveStoredUser(response.user);

  return response.user;
}

export async function logout() {
  try {
    await apiRequest("/api/auth/logout", {
      method: "POST",
    });
  } finally {
    clearStoredUser();
  }
}