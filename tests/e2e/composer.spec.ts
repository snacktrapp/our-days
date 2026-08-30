import type { Locator } from "@playwright/test";
import { expect, test } from "./test";

async function expectReachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 1 });
}

async function expectMinimumTargets(dialog: Locator) {
  const undersized = await dialog.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.textContent?.trim(),
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(({ width, height }) => width < 43.9 || height < 43.9),
  );
  expect(undersized).toEqual([]);
}

test("composer is modal, contains focus, confirms drafts, and restores focus", async ({
  page,
}) => {
  await page.goto("/family");
  const trigger = page.getByRole("button", { name: "Add moment" });
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await expect(
    page.getByRole("button", { name: /Photo or video/ }),
  ).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expectMinimumTargets(dialog);

  let backgroundBlocked = false;
  try {
    await page
      .locator('a[href="/people"]')
      .first()
      .click({ trial: true, timeout: 500 });
  } catch {
    backgroundBlocked = true;
  }
  expect(backgroundBlocked).toBe(true);

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toBeVisible();

  await dialog
    .getByRole("button", { name: "A thought A few words to keep", exact: true })
    .click();
  await expectMinimumTargets(dialog);
  const text = page.getByRole("textbox", { name: "Moment text" });
  await text.fill("A draft worth keeping");

  page.once("dialog", async (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Close moment composer" }).click();
  await expect(text).toHaveValue("A draft worth keeping");

  page.once("dialog", async (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Close moment composer" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("Escape and backdrop dismissal restore focus without a draft", async ({
  page,
}) => {
  await page.goto("/family");
  const trigger = page.getByRole("button", { name: "Add moment" });

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keyboard-sized viewport keeps focused and scrolled controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  const backgroundScroll = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Add moment" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "A thought A few words to keep", exact: true })
    .click();
  const text = page.getByRole("textbox", { name: "Moment text" });
  await text.fill("Short screen");
  await expect(text).toBeFocused();

  await page.setViewportSize({ width: 320, height: 350 });
  await expect(text).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);

  for (const control of [
    text,
    page.getByRole("button", { name: /Today/ }),
    page.getByRole("button", { name: /Mine/ }),
    page.getByRole("button", { name: "Save moment" }),
  ]) {
    await expectReachable(control);
  }
});
