import { expect, test } from "./test";

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
  await expect(
    dialog.getByRole("navigation", { name: "Choose a family timeline" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
