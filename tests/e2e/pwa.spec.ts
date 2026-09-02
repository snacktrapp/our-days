import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Service-worker lifecycle assertions run in the dedicated Chromium PWA project.",
);

test("manifest is installable and legacy service-worker state is retired", async ({
  page,
  request,
}) => {
  await page.goto("/family");
  await expect
    .poll(() =>
      page.evaluate(async () => ({
        registrations: (
          await navigator.serviceWorker.getRegistrations()
        ).filter(({ active, installing, waiting }) =>
          [active, installing, waiting].some((worker) =>
            worker?.scriptURL.startsWith(window.location.origin),
          ),
        ).length,
        legacyCaches: (await caches.keys()).filter((name) =>
          name.startsWith("our-days-public-shell-"),
        ),
      })),
    )
    .toEqual({ registrations: 0, legacyCaches: [] });

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: "/",
    scope: "/",
    start_url: "/",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
      expect.objectContaining({ purpose: "maskable" }),
    ]),
  );
});

test("a failed media request leaves the timeline stable without leaking errors", async ({
  page,
  expectedConsoleErrors,
  expectedRequestFailures,
}) => {
  expectedConsoleErrors.push("Failed to load resource: net::ERR_FAILED");
  expectedRequestFailures.push("/_next/image?");
  await page.route("**/_next/image?*", (route) => route.abort());
  await page.goto("/family");
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeVisible();
  await expect(page.locator(".time-rail")).toBeVisible();
  await expect(page.locator("#moment-kitchen")).toBeVisible();
});
