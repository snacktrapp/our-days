import type { Page } from "@playwright/test";
import { expect, test } from "./test";

async function pullFeed(
  page: Page,
  distance: number,
  options?: { dx?: number },
) {
  await page.evaluate(
    ({ distance, dx }) => {
      const target = document.querySelector(".timeline") ?? document.body;
      const startX = 180;
      const startY = 220;
      const fire = (type: string, x: number, y: number) => {
        const touch = {
          identifier: 1,
          target,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 2,
          radiusY: 2,
          rotationAngle: 0,
          force: 1,
        };
        const ended = type === "touchend";
        // WebKit forbids `new Touch()` / `new TouchEvent()` from script.
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, {
          touches: ended ? [] : [touch],
          targetTouches: ended ? [] : [touch],
          changedTouches: [touch],
        });
        target.dispatchEvent(event);
      };
      fire("touchstart", startX, startY);
      fire("touchmove", startX + dx / 2, startY + distance / 2);
      fire("touchmove", startX + dx, startY + distance);
      fire("touchend", startX + dx, startY + distance);
    },
    { distance, dx: options?.dx ?? 0 },
  );
}

async function waitForFamilyFeed(page: Page) {
  await expect(page.getByRole("button", { name: "Add moment" })).toBeVisible();
  await expect(page.locator(".timeline-pull-shell")).toHaveAttribute(
    "data-pull-state",
    "idle",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}

test("pulling the Family feed at the top refreshes moments", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family", { waitUntil: "networkidle" });
  const shell = page.locator(".timeline-pull-shell");
  await waitForFamilyFeed(page);
  await expect(page.locator(".timeline-refresh-mark")).toHaveCount(1);

  let rscRefreshes = 0;
  page.on("request", (request) => {
    const headers = request.headers();
    if (headers["rsc"] === "1" || headers["next-router-state-tree"]) {
      rscRefreshes += 1;
    }
  });

  await pullFeed(page, 90);
  await expect(shell).toHaveAttribute("data-pull-state", "refreshing");
  await expect(page.locator("#journal-live-region")).toHaveText(
    "Checking for newer days.",
  );
  await expect.poll(() => rscRefreshes).toBeGreaterThan(0);
  await expect(shell).toHaveAttribute("data-pull-state", "idle");
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeVisible();
  await expect(page.locator(".time-rail")).toBeVisible();
});

test("a sideways swipe at the top of Family does not refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family", { waitUntil: "networkidle" });
  const shell = page.locator(".timeline-pull-shell");
  await waitForFamilyFeed(page);

  let rscRefreshes = 0;
  page.on("request", (request) => {
    const headers = request.headers();
    if (headers["rsc"] === "1" || headers["next-router-state-tree"]) {
      rscRefreshes += 1;
    }
  });

  await pullFeed(page, 90, { dx: 110 });
  await expect(shell).toHaveAttribute("data-pull-state", "idle");
  expect(rscRefreshes).toBe(0);
  await expect(page.locator("html")).toHaveCSS("overflow-x", /clip|hidden/u);
});

test("personal journals share the same pull-to-refresh shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/people/molly", { waitUntil: "networkidle" });
  await expect(page.locator(".timeline-pull-shell")).toHaveAttribute(
    "data-pull-state",
    "idle",
  );
  await expect(
    page.getByRole("heading", { name: /Molly/u }).first(),
  ).toBeVisible();
});

test("reduced motion keeps the refresh mark from pulsing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family", { waitUntil: "networkidle" });
  await waitForFamilyFeed(page);
  await pullFeed(page, 90);
  const animation = await page
    .locator(".timeline-refresh-mark")
    .evaluate((mark) => getComputedStyle(mark).animationName);
  expect(animation === "none" || animation === "").toBe(true);
  await expect(page.locator(".timeline-pull-shell")).toHaveAttribute(
    "data-pull-state",
    /refreshing|idle|settling/u,
  );
});
