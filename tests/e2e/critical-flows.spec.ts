import { expect, test } from "./test";

test("Circles fits the mobile canvas in both appearances", async ({
  page,
}, testInfo) => {
  for (const theme of ["dark", "light"] as const) {
    await page.addInitScript((appearance) => {
      localStorage.setItem("our-days-theme", appearance);
    }, theme);
    await page.goto("/circles");
    await expect(
      page.getByRole("link", { name: /Open All our days circle feed/ }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const geometry = await page.evaluate(() => {
      const header = document.querySelector(".topbar")!.getBoundingClientRect();
      const nav = document
        .querySelector(".bottom-nav")!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        headerTop: header.top,
        navBottom: nav.bottom,
        height: window.innerHeight,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.headerTop).toBeGreaterThanOrEqual(0);
    expect(geometry.navBottom).toBeLessThanOrEqual(geometry.height);
    await page.screenshot({
      path: testInfo.outputPath(`circles-${theme}.png`),
    });
  }
});

test("family journal paints and opens its journal selector @critical", async ({
  page,
}) => {
  await page.goto("/family");

  await expect(
    page.getByRole("region", { name: "Chronological moments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All circles" }),
  ).toBeVisible();
  await expect(page.getByLabel("Opening this journal")).toHaveCount(0);
  await expect(page.getByText("Something interrupted the story")).toHaveCount(
    0,
  );

  const trigger = page.getByRole("button", { name: "Choose a journal" });
  await trigger.click();
  const dialog = page.getByRole("navigation", {
    name: "Choose a journal",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveText(["Just me", "All circles"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const triggerBox = await trigger.boundingBox();
  const menuBox = await dialog.boundingBox();
  expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
  expect(menuBox!.y - (triggerBox!.y + triggerBox!.height)).toBeLessThan(40);
  expect(menuBox!.height).toBeLessThan(130);
  await page.screenshot({
    path: test.info().outputPath("header-selector.png"),
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await trigger.click();
  await expect(dialog).toBeHidden();
  await trigger.click();
  await page
    .locator(".moment-card")
    .first()
    .click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
});

test("page transitions show only the plain background", async ({ page }) => {
  await page.goto("/family");
  await expect(page.locator(".moment-card").first()).toBeVisible();
  let resume!: () => void;
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route("**/circles*", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page
      .getByLabel("Primary navigation")
      .getByRole("link", { name: "Circles", exact: true })
      .click();
    const pending = page.locator(".route-pending-field");
    await expect(pending).toBeVisible();
    const icons = page.locator(".bottom-nav .nav-symbol svg");
    await expect(icons).toHaveCount(3);
    for (const icon of await icons.all()) await expect(icon).toBeVisible();
    await expect(
      page.locator(
        ".phone-stage .time-rail:visible, .route-pending-card:visible",
      ),
    ).toHaveCount(0);
    await expect(pending).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.screenshot({
      path: test.info().outputPath("plain-background-transition.png"),
    });
  } finally {
    resume();
  }
  await expect(
    page.getByRole("link", { name: /Open All our days circle feed/ }),
  ).toBeVisible();
});

test("Journal, Circles, and Settings remain distinct with one Add entry point @critical", async ({
  page,
}) => {
  await page.goto("/family");
  await page.getByRole("button", { name: "Choose a journal" }).click();
  await page.getByRole("link", { name: "Just me", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Just me", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveAttribute("href", "/people/brian");
  await page
    .getByLabel("Primary navigation")
    .getByRole("link", { name: "Circles", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Circles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveAttribute("href", "/people/brian");
  await expect(
    page.locator(".topbar").getByRole("button", { name: /Add/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("link", { name: /Open All our days circle feed/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "All our days", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveAttribute("href", "/people/brian");
  await expect(
    page
      .getByLabel("Primary navigation")
      .getByRole("link", { name: "Circles", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Choose a journal" }),
  ).toHaveCount(0);
  await page.locator(".circle-back-link").click();
  await page.getByRole("link", { name: "Molly — open journal" }).click();
  await expect(
    page.getByRole("heading", { name: "Molly", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveAttribute("href", "/people/brian");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Written entry Text/ }).click();
  await expect(page.getByRole("checkbox", { name: "Just me" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveAttribute("href", "/people/brian");
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Just me", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".circle-back-link")).toHaveCount(0);
});

test("Add chooser opens low with reachable types and supports dismiss + pick flows @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/family");

  const addTrigger = page.getByRole("button", { name: "Add", exact: true });
  await addTrigger.click();

  const picker = page.locator(".new-moment-composer-dialog");
  await expect(picker).toBeVisible();
  const sheet = picker.locator(".composer-sheet");
  const chooserGeometry = await sheet.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      viewport: window.innerHeight,
    };
  });
  expect(chooserGeometry.height).toBeGreaterThanOrEqual(
    chooserGeometry.viewport * 0.4,
  );
  expect(chooserGeometry.height).toBeLessThanOrEqual(
    chooserGeometry.viewport * 0.6,
  );
  expect(chooserGeometry.top).toBeGreaterThanOrEqual(
    chooserGeometry.viewport * 0.34,
  );
  const bottomInset = chooserGeometry.viewport - chooserGeometry.bottom;
  expect(Math.abs(bottomInset)).toBeLessThanOrEqual(40);

  for (const entryType of [
    /^Photo or video/u,
    /^Written entry/u,
    /^Bible verse/u,
    /^Drafts/u,
  ]) {
    await expect(
      picker.getByRole("button", { name: entryType }),
    ).toBeInViewport({
      ratio: 0.95,
    });
  }
  const chooserFitsWithoutScroll = await sheet
    .locator(".composer-sheet-body")
    .evaluate((element) => element.scrollHeight <= element.clientHeight + 1);
  expect(chooserFitsWithoutScroll).toBe(true);

  await picker.click({ position: { x: 10, y: 10 } });
  await expect(picker).toBeHidden();

  await addTrigger.click();
  await picker
    .getByRole("button", {
      name: "Written entry Text, date, and details",
      exact: true,
    })
    .click();
  await expect(page.getByRole("textbox", { name: "Entry" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
});
