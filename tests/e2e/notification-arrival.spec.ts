import type { Page } from "@playwright/test";
import { expect, test } from "./test";

async function expectNavPinned(page: Page) {
  const gap = await page.evaluate(() => {
    const nav = document.querySelector(".bottom-nav");
    if (!(nav instanceof HTMLElement)) return null;
    const box = nav.getBoundingClientRect();
    return {
      gap: window.innerHeight - box.bottom,
      inset: getComputedStyle(document.documentElement)
        .getPropertyValue("--vv-bottom-inset")
        .trim(),
    };
  });
  expect(gap).not.toBeNull();
  expect(gap!.gap).toBeGreaterThanOrEqual(0);
  expect(gap!.gap).toBeLessThan(48);
  expect(gap!.inset === "" || gap!.inset === "0px").toBe(true);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const) {
  test(`notification opens the post in All circles @critical ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/family?circle=family#moment-sunset");
    await expect(page).toHaveURL(/\/family\?moment=sunset$/);
    await expect(
      page.getByRole("heading", { name: "All circles" }),
    ).toBeVisible();
    const post = page.locator("#moment-sunset");
    await expect(post).toBeVisible();
    await expect(post).toHaveClass(/notification-target/);
    await expectNavPinned(page);
  });
}

test("comment notification opens the post thread @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family?moment=sunset&note=sunset-note-molly&thread=1");
  await expect(page.locator("#note-sunset-note-molly")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All circles" }),
  ).toBeVisible();
  await expectNavPinned(page);
});

test("notification target beyond the first page stays in All circles @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family?moment=porch-light-2019");
  await expect(page.locator("#moment-porch-light-2019")).toBeVisible();
  await expect(page).toHaveURL(/moment=porch-light-2019/);
  await expect(
    page.getByRole("heading", { name: "All circles" }),
  ).toBeVisible();
  await expectNavPinned(page);
});

test("deleted notification target leaves a quiet note @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family?moment=missing-entry");
  await expect(
    page.getByRole("status").filter({
      hasText: "That entry isn’t available anymore.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All circles" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNavPinned(page);
});

test("resume and route changes keep the bottom nav pinned @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family?moment=sunset");
  await page.evaluate(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 520,
        width: 390,
        offsetTop: 0,
        addEventListener() {},
        removeEventListener() {},
      },
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expectNavPinned(page);
  await page.goto("/people/brian");
  await expectNavPinned(page);
  await page.goto("/family?circle=family");
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeVisible();
  await expectNavPinned(page);
});
