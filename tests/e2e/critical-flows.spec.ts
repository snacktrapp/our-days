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
  const dialog = page.getByRole("dialog", { name: "Journal" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveText(["Just me", "All circles"]);
  await expect(
    dialog.getByRole("navigation", { name: "Choose a family timeline" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
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
