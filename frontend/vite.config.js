import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Where the dev server proxies API and Socket.io traffic. Playwright points
// this at its own backend port; normal development uses :5000.
const apiProxyTarget = process.env.API_PROXY_TARGET || "http://localhost:5000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": apiProxyTarget,
      // Socket.io (polling + WebSocket upgrade). The browser's Origin header
      // is forwarded unchanged so the backend's Origin allow-list applies.
      "/socket.io": {
        target: apiProxyTarget,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    pool: "threads",
  },
});
