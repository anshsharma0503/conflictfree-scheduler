import { defineConfig, devices } from "@playwright/test";
import {
  E2E_API_PORT,
  E2E_API_URL,
  E2E_BASE_URL,
  E2E_MONGODB_URI,
  E2E_WEB_PORT,
} from "./e2e/e2eEnv.js";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/globalSetup.js",

  use: {
    baseURL: E2E_BASE_URL,
    // Keep a full trace for any failure so intermittent issues can be diagnosed.
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],

  // Dedicated ports + a dedicated, freshly reset database (see e2e/e2eEnv.js).
  webServer: [
    {
      name: "Backend",
      command: "npm --prefix ../backend run start",
      url: `${E2E_API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        PORT: String(E2E_API_PORT),
        MONGODB_URI: E2E_MONGODB_URI,
        FRONTEND_URL: E2E_BASE_URL,
      },
    },
    {
      name: "Frontend",
      command: `npm run dev -- --host 127.0.0.1 --port ${E2E_WEB_PORT} --strictPort`,
      url: E2E_BASE_URL,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        API_PROXY_TARGET: E2E_API_URL,
      },
    },
  ],
});
