import { expect, test } from "./test";

test("chip row sits between the comment field and Post", async ({ page }) => {
  await page.goto("/family");
  const card = page.locator('[data-moment-kind="photo"]').first();
  await card.getByRole("button", { name: /Add a note to/u }).click();
  const dialog = page.getByRole("dialog", { name: "Add comment" });
  const field = dialog.getByRole("textbox");
  await field.fill("@");
  const row = dialog.getByRole("listbox", { name: "Mention a circle member" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("option", { name: "Molly" })).toBeVisible();
  await expect(row.getByRole("option", { name: "Brian" })).toHaveCount(0);

  const boxes = await dialog.evaluate((element) => {
    const header = element
      .querySelector(".activity-sheet-bar")!
      .getBoundingClientRect();
    const input = element.querySelector("textarea")!.getBoundingClientRect();
    const chips = element
      .querySelector(".mention-chip-row")!
      .getBoundingClientRect();
    const post = [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Post")!
      .getBoundingClientRect();
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    return {
      headerBottom: header.bottom,
      inputBottom: input.bottom,
      chipsTop: chips.top,
      chipsBottom: chips.bottom,
      chipsHeight: chips.height,
      postTop: post.top,
      postBottom: post.bottom,
      viewport,
      overflow:
        element.querySelector(".mention-chip-row")!.scrollWidth >
        element.querySelector(".mention-chip-row")!.clientWidth,
    };
  });
  expect(boxes.chipsTop).toBeGreaterThanOrEqual(boxes.inputBottom - 1);
  expect(boxes.chipsBottom).toBeLessThanOrEqual(boxes.postTop + 1);
  expect(boxes.chipsTop).toBeGreaterThan(boxes.headerBottom);
  expect(boxes.chipsHeight).toBeGreaterThanOrEqual(44);
  expect(boxes.postBottom).toBeLessThanOrEqual(boxes.viewport);
  expect(boxes.overflow).toBe(true);
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-chips-comment.png",
  });

  await field.fill("@m");
  await expect(row.getByRole("option", { name: "Molly" })).toBeVisible();
  await expect(row.getByRole("option", { name: "Nana" })).toHaveCount(0);
  const before = await dialog
    .getByRole("button", { name: "Post" })
    .boundingBox();
  await row.getByRole("option", { name: "Molly" }).click();
  await expect(field).toHaveValue("@Molly ");
  await expect(field).toBeFocused();
  await expect(row).toBeHidden();
  const after = await dialog
    .getByRole("button", { name: "Post" })
    .boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(8);
  expect(after!.y + after!.height).toBeLessThanOrEqual(boxes.viewport + 1);
});

test("Just me captions show no mention chips", async ({ page }) => {
  await page.goto("/family");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Written entry/u }).click();
  const dialog = page.getByRole("dialog");
  const field = dialog.getByRole("textbox", { name: "Entry" });
  await dialog.getByRole("checkbox", { name: "Just me" }).check();
  await field.fill("@");
  await expect(
    dialog.getByRole("listbox", { name: "Mention a circle member" }),
  ).toHaveCount(0);

  await dialog.getByRole("checkbox", { name: "Just me" }).uncheck();
  await field.fill("@");
  await expect(
    dialog.getByRole("listbox", { name: "Mention a circle member" }),
  ).toBeVisible();
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-chips-composer.png",
  });
});
