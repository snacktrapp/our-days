import { defineConfig, devices } from "@playwright/test";

const localJournalURL = "http://127.0.0.1:3102";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /local-journal\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: localJournalURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["iPhone 13"],
    browserName: "chromium",
  },
  webServer: {
    command:
      "rm -rf .data/our-days-e2e && npm run start -- --hostname 127.0.0.1 --port 3102",
    url: localJournalURL,
    env: {
      ...process.env,
      VERCEL: "",
      VERCEL_ENV: "",
      NEXT_PUBLIC_VERCEL_ENV: "",
      OUR_DAYS_ENVIRONMENT: "local",
      OUR_DAYS_RESOURCE_MODE: "detached",
      OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
      OUR_DAYS_ENABLE_DESIGN_PREVIEW: "false",
      OUR_DAYS_INVITATION_DELIVERY_MODE: "disabled",
      OUR_DAYS_MEDIA_DELIVERY_MODE: "disabled",
      OUR_DAYS_PHOTO_POSTING_MODE: "disabled",
      OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "",
      OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SITE_URL: localJournalURL,
      OUR_DAYS_GOOGLE_CLIENT_ID: "",
      OUR_DAYS_GOOGLE_CLIENT_SECRET: "",
      OUR_DAYS_X_CLIENT_ID: "",
      OUR_DAYS_X_CLIENT_SECRET: "",
      OUR_DAYS_LOCAL_JOURNAL_DIR: ".data/our-days-e2e",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
