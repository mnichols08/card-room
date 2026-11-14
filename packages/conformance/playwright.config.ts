import { defineConfig } from "@playwright/test";

// The built pages (npm run build), served by Vite's preview. Chrome is the one already on the
// machine (GitHub's runners have it), so there's no browser to download.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4179", channel: "chrome", launchOptions: { args: ["--no-sandbox"] } },
  webServer: { command: "npx vite preview", url: "http://localhost:4179/element/", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
