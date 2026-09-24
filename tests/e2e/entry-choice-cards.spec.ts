import { expectTypePickerHugsContent } from "./composer-type-picker";
import { expect, test } from "./test";

for (const theme of ["dark", "light"]) {
  test(`${theme} entry chooser has four compact cards without scrolling`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("our-days-theme", value),
      theme,
    );
    await page.goto("/family");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const sheet = page.locator(".new-moment-composer-dialog .composer-sheet");
    await expectTypePickerHugsContent(sheet);
    const choices = page.locator(".moment-choices");
    const cards = choices.locator("button");
    await expect(cards).toHaveCount(4);
    await expect(choices.locator("svg")).toHaveCount(0);
    for (const byline of [
      "Media with date and note",
      "Text, date, and details",
      "Choose a passage",
      "Unfinished entries",
    ]) {
      await expect(choices.getByText(byline, { exact: true })).toBeVisible();
    }
    await expect(cards.first()).toHaveCSS("text-align", "left");
    const bounds = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
        };
      }),
    );
    expect(bounds[0].y).toBe(bounds[1].y);
    expect(bounds[2].y).toBe(bounds[3].y);
    expect(bounds[2].y).toBeGreaterThan(bounds[0].bottom);
    for (const card of bounds) {
      // Fractional pixels can result from the sheet's transform.
      expect(card.height).toBeGreaterThanOrEqual(85);
      expect(card.height).toBeLessThanOrEqual(110);
      expect(card.width).toBeGreaterThanOrEqual(120);
      expect(card.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    expect(
      await page
        .locator(".composer-sheet-body")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/our-days-entry-cards-${theme}-${test.info().project.name}.png`,
    });
    // Tap the card padding, not its icon or label.
    await cards.nth(1).click({ position: { x: 8, y: 8 } });
    await expect(page.getByLabel("Entry", { exact: true })).toBeVisible();
  });
}
