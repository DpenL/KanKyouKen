import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the built games served by `vite preview`.
 * Run `npm run build` first (the `e2e` script does). Set KK_CHROMIUM to the path of a
 * Chromium binary to use it instead of the one Playwright downloads.
 */
const chromium = process.env.KK_CHROMIUM;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  webServer: [
    {
      command: "npm run preview -w @kankyouken/fude-uta -- --port 4311 --strictPort",
      url: "http://127.0.0.1:4311",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run preview -w @kankyouken/kumiki -- --port 4312 --strictPort",
      url: "http://127.0.0.1:4312",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
