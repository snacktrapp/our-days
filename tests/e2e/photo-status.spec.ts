import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

test("private photo notices fit and remain accessible at 320px", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/quality/photo-status");

  await expect(
    page.getByRole("region", { name: "Private photo status" }),
  ).toBeVisible();
  const layout = await page.evaluate(() => {
    const shelf = document
      .querySelector(".photo-status-shelf")!
      .getBoundingClientRect();
    const controls = [...document.querySelectorAll<HTMLElement>("button")].map(
      (button) => {
        const box = button.getBoundingClientRect();
        return { height: box.height, width: box.width };
      },
    );
    return {
      controls,
      documentFits:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      shelfFits: shelf.left >= 0 && shelf.right <= innerWidth,
    };
  });
  expect(layout.documentFits).toBe(true);
  expect(layout.shelfFits).toBe(true);
  expect(
    layout.controls.every(({ height, width }) => height >= 44 && width >= 44),
  ).toBe(true);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});
