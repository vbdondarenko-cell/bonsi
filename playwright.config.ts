import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/admin/**",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: ".ci/e2e.json" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", testIgnore: ["**/admin/**", "**/mobile-navigation.spec.ts"], use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testIgnore: ["**/admin/**", "**/mobile-navigation.spec.ts"], use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testIgnore: ["**/admin/**", "**/mobile-navigation.spec.ts"], use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", testMatch: "**/mobile-navigation.spec.ts", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", testMatch: "**/mobile-navigation.spec.ts", use: { ...devices["iPhone 13"] } },
  ],
});
