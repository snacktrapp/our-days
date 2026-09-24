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
    await expect(page).toHaveURL(/\/family$/);
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
  await expect(page).not.toHaveURL(/[?&](?:moment|note|thread)=/);
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
  await expect(page).not.toHaveURL(/[?&]moment=/);
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

async function openNotification(page: Page, url: string) {
  await page.evaluate((href) => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "our-days:notification-open", url: href },
      }),
    );
  }, url);
}

async function postOffset(page: Page, selector: string) {
  return page.locator(selector).evaluate((node) => {
    const topbar = document.querySelector(".topbar");
    const inset =
      topbar instanceof HTMLElement ? topbar.getBoundingClientRect().bottom : 0;
    return node.getBoundingClientRect().top - inset;
  });
}

test("several notifications land once, anchor late media, then let the reader scroll to the top @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const positions: number[] = [];
    window.addEventListener(
      "scroll",
      () => positions.push(Math.round(window.scrollY)),
      { passive: true },
    );
    Object.assign(window, { __notificationScrolls: positions });
  });
  await page.goto("/family?moment=sunset&note=sunset-note-molly&thread=1");
  const sunset = page.locator("#moment-sunset");
  await expect(sunset).toBeVisible();
  await expect(page.locator("#note-sunset-note-molly")).toBeVisible();
  await expect(sunset).toHaveClass(/notification-target/);
  await expect(page).not.toHaveURL(/[?&]moment=/);
  const landingScrolls = await page.evaluate(
    () =>
      (window as unknown as { __notificationScrolls: number[] })
        .__notificationScrolls,
  );
  expect(new Set(landingScrolls).size).toBeLessThanOrEqual(2);

  await openNotification(page, "/family?moment=porch-light-2019");
  const porch = page.locator("#moment-porch-light-2019");
  await expect(porch).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]moment=/);
  const landedOffset = await postOffset(page, "#moment-porch-light-2019");
  const atFeedEnd = await page.evaluate(
    () =>
      document.documentElement.scrollHeight -
        window.innerHeight -
        window.scrollY <
      2,
  );
  expect(atFeedEnd || (landedOffset > 0 && landedOffset < 40)).toBe(true);

  await page.evaluate(() => {
    const timeline = document.querySelector(".timeline");
    const spacer = document.createElement("div");
    spacer.dataset.lateMedia = "above";
    spacer.style.height = "480px";
    spacer.style.overflowAnchor = "none";
    timeline?.prepend(spacer);
  });
  await expect
    .poll(() => postOffset(page, "#moment-porch-light-2019"))
    .toBeLessThan(landedOffset + 24);
  await expect
    .poll(() => postOffset(page, "#moment-porch-light-2019"))
    .toBeGreaterThan(landedOffset - 24);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const timeline = document.querySelector(".timeline");
    const spacer = document.createElement("div");
    spacer.dataset.lateMedia = "after-release";
    spacer.style.height = "360px";
    spacer.style.overflowAnchor = "none";
    timeline?.prepend(spacer);
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(8);
  await expectNavPinned(page);

  await page.waitForTimeout(750);
  await openNotification(page, "/family?moment=sunset");
  await expect(sunset).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]moment=/);
  await expect.poll(() => postOffset(page, "#moment-sunset")).toBeLessThan(40);
  await expectNavPinned(page);
});

test("comment refresh after scrolling to the top stays on the latest day @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    performance.getEntriesByType = ((type: string) =>
      type === "navigation"
        ? [{ type: "reload" }]
        : []) as unknown as typeof performance.getEntriesByType;
  });
  await page.goto("/family?moment=porch-light-2019&note=missing-note&thread=1");
  const porch = page.locator("#moment-porch-light-2019");
  await expect(porch).toBeVisible();
  await expect(page).not.toHaveURL(/[?&](?:moment|note|thread)=/);
  const landed = await page.evaluate(() => window.scrollY);
  expect(landed).toBeGreaterThan(200);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("moment", "porch-light-2019");
    url.searchParams.set("note", "missing-note");
    url.searchParams.set("thread", "1");
    window.history.replaceState(
      { __NA: true },
      "",
      `${url.pathname}${url.search}`,
    );
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(8);
  await expect(page).not.toHaveURL(/[?&](?:moment|note|thread)=/);

  await page.goto("/family?moment=porch-light-2019&note=missing-note&thread=1");
  await expect(
    page.getByRole("heading", { name: "All circles" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(8);
  await expect(page).not.toHaveURL(/[?&](?:moment|note|thread)=/);
  await expect(porch).not.toBeInViewport();
});

test("a comment notification sits fully below the top bar @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family?moment=sunset&note=sunset-note-molly&thread=1");
  const note = page.locator("#note-sunset-note-molly");
  await expect(note).toBeVisible();
  const gap = await note.evaluate((node) => {
    const topbar = document.querySelector(".topbar");
    const top =
      topbar instanceof HTMLElement
        ? Number.parseFloat(getComputedStyle(topbar).top) || 0
        : 0;
    const height = topbar instanceof HTMLElement ? topbar.offsetHeight : 0;
    return node.getBoundingClientRect().top - (top + height);
  });
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThan(40);
});

test("a new circle post lands on that entry once, then the feed can scroll to the top @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family?moment=first-day");
  const post = page.locator("#moment-first-day");
  await expect(post).toBeVisible();
  await expect(post).toHaveClass(/notification-target/);
  await expect(
    page.getByRole("heading", { name: "All circles" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]moment=/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    document.querySelector(".timeline")?.prepend(document.createElement("div"));
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(8);
  await expectNavPinned(page);
});
