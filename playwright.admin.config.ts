import { defineConfig, devices } from "@playwright/test";

/**
 * Інтеграційні e2e адмінпанелі проти справжнього (локального) Supabase: Auth, MFA, RLS, outbox.
 * Потрібні змінні SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (див. CI).
 */
const port = 3100;
const stubPort = 4010;

export default defineConfig({
  testDir: "./e2e/admin",
  fullyParallel: false,
  workers: 1,
  retries: 0, // повтори приховували б нестабільність: збій має бути видимим
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["json", { outputFile: ".ci/e2e-admin.json" }]] : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: "node e2e/admin/telegram-stub.mjs",
      url: `http://127.0.0.1:${stubPort}/__health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run start -- -p ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
        TRUSTED_PROXY: "none",
        TELEGRAM_BOT_TOKEN: "123456:E2E-TEST-TOKEN",
        TELEGRAM_CHAT_IDS: "111222333",
        TELEGRAM_API_BASE: `http://127.0.0.1:${stubPort}`,
        CRON_SECRET: "e2e-cron-secret-0123456789abcdef",
        ORDER_HASH_SALT: "e2e-order-hash-salt-0123456789abcdef0123",
        SUPABASE_URL: process.env.SUPABASE_URL ?? "",
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      },
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, dependencies: ["chromium"] },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, dependencies: ["firefox"] },
  ],
});
