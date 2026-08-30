import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Pixel baselines intentionally use one pinned rendering engine.",
);

test("approved timeline visual stays stable", async ({ page }, testInfo) => {
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
});

test("personal timeline visual stays stable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");
  await page.goto("/people/molly");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("personal-chromium-mobile.png", {
    fullPage: true,
    animations: "disabled",
  });
});

test("composer visuals stay stable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");
  await page.goto("/family");
  await page.getByRole("button", { name: "Add moment" }).click();
  await expect(page).toHaveScreenshot("composer-chooser-chromium-mobile.png", {
    animations: "disabled",
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "A thought A few words to keep", exact: true })
    .click();
  await expect(page).toHaveScreenshot("composer-written-chromium-mobile.png", {
    animations: "disabled",
  });
});
