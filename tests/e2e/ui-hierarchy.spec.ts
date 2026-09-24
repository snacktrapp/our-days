import { expect, test } from "./test";

for (const theme of ["light", "dark"]) {
  test(`${theme} composer uses shared cool colors and secondary actions`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("our-days-theme", value),
      theme,
    );
    await page.goto("/family");
    await expect(
      page.getByRole("button", { name: "Choose a journal" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /Written entry/ }).click();
    const picker = page.locator(".composer-picker-trigger").first();
    await expect(picker).toBeVisible();
    const colors = await picker.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        actual: style.backgroundColor,
        expected: style.getPropertyValue("--surface-raised").trim(),
      };
    });
    // Resolve the theme token through the browser, rather than duplicating its hex value.
    const expected = await picker.evaluate((element, color) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = color;
      element.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    }, colors.expected);
    expect(colors.actual).toBe(expected);
    await expect(page.locator(".secondary-composer-action")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(page.locator(".post-to-chips label small").first()).toHaveCSS(
      "font-weight",
      "400",
    );
    const selection = page
      .locator(".post-to-chips label:has(input:checked)")
      .first();
    expect(
      await selection.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.getPropertyValue("--selection-fill").includes("color-mix");
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const bounds = await picker.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  });

  test(`${theme} comment actions have a clear primary and secondary hierarchy`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("our-days-theme", value),
      theme,
    );
    await page.goto("/family");
    await page
      .getByRole("button", { name: /Add a note to/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Add comment" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    const post = dialog.getByRole("button", { name: "Post", exact: true });
    await expect(post).toBeDisabled();
    const disabledColor = await post.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await dialog.getByRole("textbox").fill("Ready to post");
    await expect(post).toBeEnabled();
    expect(
      await post.evaluate((element) => getComputedStyle(element).color),
    ).not.toBe(disabledColor);
    await expect(post).toHaveCSS("min-height", "44px");
  });
}
