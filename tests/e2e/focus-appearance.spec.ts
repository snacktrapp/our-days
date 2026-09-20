import { expect, test } from "./test";

test("restored feed focus and controls never paint a focus ring", async ({
  page,
}) => {
  await page.goto("/family");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    // Reproduce the strongest focus-visible case, not only a pointer click.
    await page.keyboard.press("Tab");
    for (const selector of [
      ".timeline",
      ".quick-reaction-trigger",
      ".bottom-nav a",
    ]) {
      const target = page.locator(selector).first();
      await target.focus();
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS("outline-style", "none");
      await expect(target).toHaveCSS("box-shadow", "none");
    }
  }
});

test("posting a comment retains input and focus behavior without highlights", async ({
  page,
}) => {
  await page.goto("/family");
  const card = page.locator('[data-moment-kind="photo"]').first();
  const trigger = card.getByRole("button", { name: /Add a note to/u });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Add comment" });
  const field = dialog.getByRole("textbox", { name: "Add a family note" });
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS("outline-style", "none");
  await expect(field).toHaveCSS("box-shadow", "none");
  await field.fill("A ring-free comment");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-style", "none");
  await expect(trigger).toHaveCSS("box-shadow", "none");
  await expect(
    card.getByText("A ring-free comment", { exact: true }),
  ).toBeVisible();
});
