import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @folio/backend exec tsx test/e2e-server.ts",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @folio/frontend dev --port 5174",
      url: "http://localhost:5174",
      env: { API_PROXY: "http://127.0.0.1:3101" },
      reuseExistingServer: false,
    },
  ],
});
