import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", timeout: 60_000, workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300", channel: "msedge", headless: true, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: [["list"], ["html", { open: "never" }]],
});
