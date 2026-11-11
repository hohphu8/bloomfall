import { defineConfig } from "@playwright/test";
const port = Number(process.env.BLOOMFALL_PREVIEW_PORT || 4196);
const url = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests/production",
  workers: 1,
  use: {
    baseURL: url,
    browserName: "chromium",
    channel: process.platform === "win32" ? "chrome" : undefined,
  },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
