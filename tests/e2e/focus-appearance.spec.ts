import { expect, test } from "./test";

test("Future theme hides tap and programmatic focus rings and keeps keyboard rings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("our-days-appearance", "retro");
    window.localStorage.setItem("our-days-accent", "violet");
  });
  await page.goto("/family");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "retro",
  );

  const heart = page.getByRole("button", { name: /Open notifications/u });
  await heart.click();
  const activityHeading = page.getByRole("heading", { name: "Activity" });
  await expect(activityHeading).toBeFocused();
  await expect(activityHeading).toHaveCSS("outline-style", "none");
  await expect(activityHeading).toHaveCSS("box-shadow", "none");

  await page
    .getByRole("dialog", { name: "Activity" })
    .click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("dialog", { name: "Activity" })).toBeHidden();
  await expect(heart).toBeFocused();
  await expect(heart).toHaveCSS("outline-style", "none");
  await expect(heart).toHaveCSS("box-shadow", "none");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const newMoment = page.getByRole("heading", { name: "New moment" });
  await expect(newMoment).toBeFocused();
  await expect(newMoment).toHaveCSS("outline-style", "none");
  await expect(newMoment).toHaveCSS("box-shadow", "none");

  let sawKeyboardRing = false;
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
      };
    });
    if (focused?.outlineStyle === "solid") {
      expect(focused.outlineColor).toBe("rgb(196, 176, 245)");
      sawKeyboardRing = true;
      break;
    }
  }
  expect(sawKeyboardRing).toBe(true);
});

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
