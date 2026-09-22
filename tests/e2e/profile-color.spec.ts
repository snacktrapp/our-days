import { expect, test } from "./test";

test("twelve profile colors preview in a compact grid in both themes", async ({
  page,
}) => {
  await page.goto("/settings/family");
  const section = page.getByRole("region", { name: "Your profile" });
  await expect(section.locator("details")).not.toHaveAttribute("open");
  await section.getByText("Change color", { exact: true }).click();
  await expect(section.getByRole("radio")).toHaveCount(12);
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const swatches = section.locator(".profile-color-swatch");
    const colors = await swatches.evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).backgroundColor),
    );
    expect(new Set(colors).size).toBe(12);
    for (const radio of await section.getByRole("radio").all()) {
      await radio.check();
      await expect(radio).toBeChecked();
    }
    await section.getByRole("radio", { name: "Purple", exact: true }).check();
    await expect(
      section.locator(".profile-color-preview .person-avatar"),
    ).toHaveClass(/dot-violet/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/our-days-profile-color-${theme}.png` });
  }
  await section.getByRole("button", { name: "Save color" }).click();
  await expect(section.getByRole("status")).toContainText(
    "Preview color updated",
  );
});
