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

async function placeholderBox(field: Locator) {
  return field.evaluate((textarea) => {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Comment field is missing.");
    }
    const pill = textarea.closest(".mention-pill");
    const sheet = textarea.closest(".comment-sheet");
    const dialog = textarea.closest("dialog");
    if (
      !(pill instanceof HTMLElement) ||
      !(sheet instanceof HTMLElement) ||
      !(dialog instanceof HTMLElement)
    ) {
      throw new Error("Comment pill is missing its sheet.");
    }
    const style = getComputedStyle(textarea);
    const probe = document.createElement("span");
    probe.textContent = textarea.placeholder;
    probe.style.position = "fixed";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.font = style.font;
    document.body.append(probe);
    const text = probe.getBoundingClientRect();
    probe.remove();
    const fieldBox = textarea.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const send = pill.querySelector("button")?.getBoundingClientRect();
    const textTop = fieldBox.top + (fieldBox.height - text.height) / 2;
    const viewport = window.visualViewport;
    return {
      fontSize: Number.parseFloat(style.fontSize),
      textTop,
      textBottom: textTop + text.height,
      textCenter: textTop + text.height / 2,
      pillTop: pillBox.top,
      pillBottom: pillBox.bottom,
      fieldBottom: fieldBox.bottom,
      sendCenter: send ? send.top + send.height / 2 : textTop,
      dialogBottom: dialog.getBoundingClientRect().bottom,
      sheetBottom: sheet.getBoundingClientRect().bottom,
      vvBottom:
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
    };
  });
}

async function chipBox(dialog: Locator) {
  const row = dialog.getByRole("listbox", { name: "Mention a circle member" });
  await expect(row).toBeVisible();
  return row.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const field = element.closest(".mention-field")?.querySelector("textarea");
    const fieldBox = field?.getBoundingClientRect();
    const pill = element
      .closest(".mention-field")
      ?.querySelector(".mention-pill");
    const pillBox = pill?.getBoundingClientRect();
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const footer = document.querySelector(".composer-editor-footer");
    const footerHidden =
      footer instanceof HTMLElement &&
      getComputedStyle(footer).display === "none";
    const footerTop = footerHidden
      ? viewport
      : (footer?.getBoundingClientRect().top ?? viewport);
    return {
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      fieldTop: fieldBox?.top ?? 0,
      fieldBottom: fieldBox?.bottom ?? 0,
      pillTop: pillBox?.top ?? 0,
      viewport,
      footerTop,
      footerHidden,
      overflow: element.scrollWidth > element.clientWidth + 1,
      scrollInside: field ? field.scrollHeight > field.clientHeight + 1 : false,
    };
  });
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
  const post = dialog.getByRole("button", { name: "Post" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(post).toBeDisabled();
  const emptyPill = await placeholderBox(field);
  expect(emptyPill.fontSize).toBeGreaterThanOrEqual(16);
  expect(emptyPill.textTop).toBeGreaterThanOrEqual(emptyPill.pillTop - 1);
  expect(emptyPill.textBottom).toBeLessThanOrEqual(emptyPill.pillBottom + 1);
  expect(emptyPill.fieldBottom).toBeLessThanOrEqual(emptyPill.pillBottom + 1);
  expect(
    Math.abs(emptyPill.sendCenter - emptyPill.textCenter),
  ).toBeLessThanOrEqual(6);
  expect(
    Math.abs(emptyPill.dialogBottom - emptyPill.vvBottom),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(emptyPill.sheetBottom - emptyPill.dialogBottom),
  ).toBeLessThanOrEqual(2);
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-ig-comment-empty.png",
  });
  await field.evaluate((element) => {
    element.style.fontSize = "22px";
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  const largePill = await placeholderBox(field);
  expect(largePill.fontSize).toBeGreaterThanOrEqual(22);
  expect(largePill.textTop).toBeGreaterThanOrEqual(largePill.pillTop - 1);
  expect(largePill.textBottom).toBeLessThanOrEqual(largePill.pillBottom + 1);
  await field.evaluate((element) => {
    element.style.removeProperty("font-size");
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await field.fill("@");
  const many = await chipBox(dialog);
  expect(many.height).toBeGreaterThanOrEqual(43);
  expect(many.bottom).toBeLessThanOrEqual(many.pillTop + 1);
  expect(many.bottom).toBeLessThanOrEqual(many.viewport + 1);
  expect(many.top).toBeGreaterThanOrEqual(0);
  expect(many.overflow).toBe(true);
  expect(await dialog.getByRole("option").count()).toBeGreaterThanOrEqual(5);
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-ig-comment.png",
  });

  await field.fill("@mol");
  await expect(dialog.getByRole("option", { name: "Molly" })).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(1);

  await field.fill(
    "Line one of a long family note.\nLine two stays in the field.\nLine three.\nLine four.\nLine five.\nLine six.\nLine seven should scroll inside.",
  );
  const scrolled = await field.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );
  expect(scrolled).toBe(true);
  await field.fill("@m");
  await dialog.getByRole("option", { name: "Molly" }).click();
  await expect(field).toHaveValue("@Molly ");
  await expect(field).toBeFocused();
  await expect(post).toBeEnabled();

  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("@Molly ");
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await card.getByRole("button", { name: /Add a note to/u }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("caption composer chips sit under the note and clear the bottom bar", async ({
  page,
}) => {
  await page.goto("/family");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Written entry/u }).click();
  const dialog = page.getByRole("dialog");
  const field = dialog.getByRole("textbox", { name: "Entry" });
  await expect(dialog.getByRole("button", { name: "Post" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save draft" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await shrinkKeyboard(page, 520);
  await dialog.getByRole("checkbox", { name: "Just me" }).check();
  await field.fill("@");
  await expect(
    dialog.getByRole("listbox", { name: "Mention a circle member" }),
  ).toHaveCount(0);

  await dialog.getByRole("checkbox", { name: "Just me" }).uncheck();
  await field.fill("@");
  const many = await chipBox(dialog);
  expect(many.height).toBeGreaterThanOrEqual(43);
  expect(many.top).toBeGreaterThanOrEqual(many.fieldBottom - 1);
  expect(many.bottom).toBeLessThanOrEqual(many.viewport + 1);
  expect(many.bottom).toBeLessThanOrEqual(many.footerTop + 1);
  expect(many.footerHidden).toBe(true);
  expect(many.overflow).toBe(true);
  await field.fill("@mol");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await dialog.screenshot({
    path: "/opt/cursor/artifacts/mention-composer-inline.png",
  });
  await dialog.getByRole("option", { name: "Molly" }).click();
  await expect(field).toHaveValue("@Molly ");
  await expect(field).toBeFocused();

  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("@Molly ");
});
