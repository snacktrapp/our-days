import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";

async function shrinkKeyboard(page: Page, height = 360) {
  await page.evaluate((nextHeight) => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: nextHeight,
    });
    Object.defineProperty(window.visualViewport, "offsetTop", {
      configurable: true,
      value: 0,
    });
    window.visualViewport?.dispatchEvent(new Event("resize"));
  }, height);
}

async function expectChipsFullyVisible(dialog: Locator) {
  const row = dialog.getByRole("listbox", { name: "Mention a circle member" });
  await expect(row).toBeVisible();
  const result = await row.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const field = element
      .closest(".mention-field")
      ?.querySelector("textarea")
      ?.getBoundingClientRect();
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const footer = document.querySelector(".composer-editor-footer");
    const footerTop = footer?.getBoundingClientRect().top ?? viewport;
    return {
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      fieldBottom: field?.bottom ?? 0,
      viewport,
      footerTop,
      overflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(result.height).toBeGreaterThanOrEqual(44);
  expect(result.top).toBeGreaterThanOrEqual(result.fieldBottom - 1);
  expect(result.bottom).toBeLessThanOrEqual(result.viewport + 1);
  expect(result.bottom).toBeLessThanOrEqual(result.footerTop + 1);
  return result;
}

test("comment chips stay fully visible above a simulated keyboard", async ({
  page,
}) => {
  await page.goto("/family");
  const card = page.locator('[data-moment-kind="photo"]').first();
  await card.getByRole("button", { name: /Add a note to/u }).click();
  await shrinkKeyboard(page);
  const dialog = page.getByRole("dialog", { name: "Add comment" });
  const field = dialog.getByRole("textbox");
  await expect(dialog.getByRole("button", { name: "Post" })).toBeDisabled();
  await field.fill("@");
  const many = await expectChipsFullyVisible(dialog);
  expect(many.overflow).toBe(true);
  expect(await dialog.getByRole("option").count()).toBeGreaterThanOrEqual(5);
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-chips-comment.png",
  });

  await field.fill("@mol");
  await expect(dialog.getByRole("option", { name: "Molly" })).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expectChipsFullyVisible(dialog);

  await field.fill(
    "Line one of a long family note.\nLine two stays in the field.\nLine three.\nLine four.\nLine five.\nLine six.\nLine seven should scroll inside.",
  );
  const scrolled = await field.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );
  expect(scrolled).toBe(true);
  await field.fill("@m");
  await expectChipsFullyVisible(dialog);
  await dialog.getByRole("option", { name: "Molly" }).click();
  await expect(field).toHaveValue("@Molly ");
  await expect(field).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Post" })).toBeEnabled();
});

test("caption composer chips stay fully visible above a simulated keyboard", async ({
  page,
}) => {
  await page.goto("/family");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Written entry/u }).click();
  await shrinkKeyboard(page, 520);
  const dialog = page.getByRole("dialog");
  const field = dialog.getByRole("textbox", { name: "Entry" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Post" })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Just me" }).check();
  await field.fill("@");
  await expect(
    dialog.getByRole("listbox", { name: "Mention a circle member" }),
  ).toHaveCount(0);

  await dialog.getByRole("checkbox", { name: "Just me" }).uncheck();
  await field.fill("@");
  const many = await expectChipsFullyVisible(dialog);
  expect(many.overflow).toBe(true);
  await field.fill("@mol");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expectChipsFullyVisible(dialog);
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-chips-composer.png",
  });
  await dialog.getByRole("option", { name: "Molly" }).click();
  await expect(field).toHaveValue("@Molly ");
  await expect(field).toBeFocused();
});
