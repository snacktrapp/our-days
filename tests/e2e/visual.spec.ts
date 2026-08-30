import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Pixel baselines intentionally use one pinned rendering engine.",
);

test(
  "approved timeline visual stays stable",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(
      !["chromium-mobile", "chromium-short", "chromium-wide-visual"].includes(
        testInfo.project.name,
      ),
    );
    await page.goto("/family");
    await page
      .locator("html")
      .evaluate((element) => element.classList.add("visual-test"));
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`family-${testInfo.project.name}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  },
);

test(
  "personal timeline visual stays stable",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/people/molly");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("personal-chromium-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  },
);

test(
  "composer visuals stay stable",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/family");
    await page.getByRole("button", { name: "Add moment" }).click();
    await expect(page).toHaveScreenshot(
      "composer-chooser-chromium-mobile.png",
      { animations: "disabled" },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: "A thought A few words to keep",
        exact: true,
      })
      .click();
    await expect(page).toHaveScreenshot(
      "composer-written-chromium-mobile.png",
      { animations: "disabled" },
    );
  },
);

test(
  "memory journeys preserve the timeline identity",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    for (const [path, name] of [
      ["/memories", "memories-landing-chromium-mobile.png"],
      ["/memories/on-this-day", "memories-on-this-day-chromium-mobile.png"],
      ["/memories/years/2023", "memories-year-chromium-mobile.png"],
      ["/quality/memories-empty", "memories-empty-chromium-mobile.png"],
    ] as const) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(name, {
        fullPage: true,
        animations: "disabled",
      });
    }
  },
);

test(
  "Memories landing remains inviting on a short phone",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-short");
    await page.goto("/memories");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(
      "memories-landing-viewport-chromium-short.png",
      { animations: "disabled" },
    );
  },
);
