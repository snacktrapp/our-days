import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Service-worker lifecycle assertions run in the dedicated Chromium PWA project.",
);

const allowedCachePaths = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

test("manifest is installable and service worker caches only the public allowlist", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/family");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = (
      await Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name);
          return (await cache.keys()).map(
            (request) => new URL(request.url).pathname,
          );
        }),
      )
    )
      .flat()
      .sort();
    return { names, urls };
  });
  expect(cacheState.names).toEqual(["our-days-public-shell-v1"]);
  expect(cacheState.urls).toEqual([...allowedCachePaths].sort());
  expect(cacheState.urls).not.toContain("/family");

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

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "You’re offline." }),
  ).toBeVisible();
  await expect(page.getByText("All our days")).toHaveCount(0);
  await context.setOffline(false);
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
  await expect(page.locator('[data-moment-kind="thought"]')).toBeVisible();
});
