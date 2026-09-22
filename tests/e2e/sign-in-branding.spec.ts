import { expect, test } from "./test";

test("sign-in uses the shared wordmark in both themes", async ({
  page,
}, testInfo) => {
  for (const theme of ["dark", "light"]) {
    for (const path of ["/sign-in"]) {
      await page.goto(`http://127.0.0.1:3101${path}`);
      await expect(page).toHaveURL(/\/sign-in$/);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const logo = page.getByRole("img", { name: "Our Days", exact: true });
      await expect(logo).toBeVisible();
      await expect(logo).toHaveClass(/our-days-wordmark/);
      await expect(logo).toHaveCSS("width", "168px");
      expect(
        await logo.evaluate((el) => getComputedStyle(el).maskImage),
      ).toContain("our-days-wordmark.svg");
      await expect(page.locator(".private-entry-mark")).toHaveCount(0);
      expect(await page.locator("main").innerText()).not.toMatch(
        /\b(family|relatives?)\b/i,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/our-days${path}-${theme}-${testInfo.project.name}.png`,
      });
    }
  }
});
