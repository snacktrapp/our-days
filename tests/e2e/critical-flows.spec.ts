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
    page.getByRole("region", { name: "Chronological family moments" }),
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
    name: "Choose a family timeline",
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
    await page.getByRole("link", { name: "Circles", exact: true }).click();
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
  await page.getByRole("link", { name: "Circles", exact: true }).click();
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
    page.getByRole("link", { name: "Circles", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Choose a journal" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "← Back to Circles" }).click();
  await page.getByRole("link", { name: /Molly.*View journal/ }).click();
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
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveAttribute("href", "/people/brian");
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Just me", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "← Back to Circles" }),
  ).toHaveCount(0);
});
