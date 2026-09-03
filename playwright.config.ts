import { defineConfig, devices } from "@playwright/test";

const previewURL = "http://127.0.0.1:3100";
const includeWebKit = Boolean(
  process.env.CI || process.env.PLAYWRIGHT_INCLUDE_WEBKIT,
);

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: /local-journal\.spec\.ts/,
  fullyParallel: true,
  // Nonce-protected pages render per request. A single browser worker keeps
  // the local production server deterministic across engines; two workers
  // can starve Firefox's first full-page navigation under local CI load.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: previewURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  expect: { timeout: 8_000 },
  webServer: [
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3100",
      url: previewURL,
      env: {
        ...process.env,
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_INVITATION_DELIVERY_MODE: "disabled",
        OUR_DAYS_MEDIA_DELIVERY_MODE: "disabled",
        OUR_DAYS_PHOTO_POSTING_MODE: "disabled",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "",
        OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_SITE_URL: previewURL,
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101",
      env: {
        ...process.env,
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_INVITATION_DELIVERY_MODE: "disabled",
        OUR_DAYS_MEDIA_DELIVERY_MODE: "disabled",
        OUR_DAYS_PHOTO_POSTING_MODE: "disabled",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "",
        OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3101",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "false",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    ...(includeWebKit
      ? [
          {
            name: "webkit-mobile",
            use: { ...devices["iPhone 13"], browserName: "webkit" as const },
          },
        ]
      : []),
    {
      name: "firefox-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        browserName: "firefox",
        hasTouch: true,
      },
    },
    {
      name: "chromium-short",
      use: {
        viewport: { width: 320, height: 568 },
        browserName: "chromium",
        hasTouch: true,
      },
    },
    {
      name: "chromium-wide-visual",
      testMatch: /visual\.spec\.ts/,
      use: {
        viewport: { width: 430, height: 932 },
        browserName: "chromium",
        hasTouch: true,
      },
    },
  ],
});
