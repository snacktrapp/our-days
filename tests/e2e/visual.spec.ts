import type { Locator } from "@playwright/test";
import { expect, test } from "./test";

async function selectBiblePassage(
  dialog: Locator,
  passage: Readonly<{
    book: string;
    chapter: number;
    start: number;
    end?: number;
  }>,
) {
  await dialog.getByRole("button", { name: /^Book,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose book" })
    .getByRole("menuitemradio", { name: passage.book, exact: true })
    .click();
  await dialog.getByRole("button", { name: /^Chapter,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose chapter" })
    .getByRole("button", { name: `Chapter ${passage.chapter}` })
    .click();
  await dialog.getByRole("button", { name: /^Starting verse,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose starting verse" })
    .getByRole("button", { name: `Starting verse ${passage.start}` })
    .click();
  if (passage.end && passage.end !== passage.start) {
    await dialog.getByRole("button", { name: /^Ending verse,/u }).click();
    await dialog
      .getByRole("dialog", { name: "Choose ending verse" })
      .getByRole("button", { name: `Ending verse ${passage.end}` })
      .click();
  }
}

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Pixel baselines intentionally use one pinned rendering engine.",
);

test(
  "approved timeline visual stays stable",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(
      !["chromium-mobile", "chromium-short", "chromium-wide-visual"].includes(
        testInfo.project.name,
      ),
    );
    await page.goto("/family");
    await page
      .locator("html")
      .evaluate((element) => element.classList.add("visual-test"));
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`family-${testInfo.project.name}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  },
);

test(
  "personal timeline visual stays stable",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/people/molly");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot("personal-chromium-mobile.png", {
      animations: "disabled",
    });
  },
);

test(
  "managed personal journals preserve populated and first-moment states",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    for (const [path, name] of [
      ["/people/avery", "personal-avery-chromium-mobile.png"],
      ["/people/sam", "personal-sam-empty-chromium-mobile.png"],
    ] as const) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot(name, {
        animations: "disabled",
      });
      if (path === "/people/avery") {
        await page
          .locator("[data-moment-kind]")
          .last()
          .scrollIntoViewIfNeeded();
        await expect(page).toHaveScreenshot(
          "personal-avery-ending-chromium-mobile.png",
          { animations: "disabled" },
        );
      }
    }
  },
);

test(
  "composer visuals stay stable",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/family");
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("button", { name: "Add moment" }).click();
    await expect(page).toHaveScreenshot(
      "composer-chooser-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: "Written entry Text, date, and details",
        exact: true,
      })
      .click();
    await page
      .getByRole("textbox", { name: "Entry" })
      .fill("A backpack almost as big as Avery, and one brave wave goodbye.");
    await page.getByLabel("Moment date").fill("2023-08-21");
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Journal", exact: true })
      .selectOption("avery");
    await page.getByRole("button", { name: /Details/u }).click();
    await page.getByRole("checkbox", { name: /Molly/u }).check();
    await page.getByRole("button", { name: /^Place,/u }).click();
    await page.getByLabel("Place name").fill("Oak Street School");
    await expect(page).toHaveScreenshot(
      "composer-written-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page.getByRole("button", { name: "Preview moment" }).click();
    await expect(page).toHaveScreenshot("composer-review-chromium-mobile.png", {
      animations: "disabled",
      caret: "hide",
    });
    await page.getByRole("button", { name: "Close preview" }).click();

    await page.getByRole("button", { name: "Add moment" }).click();
    await page.getByRole("button", { name: /^Photo/u }).click();
    await page
      .getByLabel(/Choose photo/u)
      .setInputFiles("public/sample-family.jpg");
    await expect(
      page.getByText("Photo ready for this local preview."),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Note" })
      .fill("The last warm hour before dinner.");
    await expect(page).toHaveScreenshot("composer-photo-chromium-mobile.png", {
      animations: "disabled",
      caret: "hide",
    });
    await page.getByRole("button", { name: "Preview moment" }).click();
    await expect(page).toHaveScreenshot(
      "composer-photo-review-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page.getByRole("button", { name: "Close preview" }).click();

    await page.getByRole("button", { name: "Add moment" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Bible verse/u })
      .click();
    const bibleDialog = page.getByRole("dialog").first();
    await selectBiblePassage(bibleDialog, {
      book: "John",
      chapter: 3,
      start: 16,
    });
    await expect(bibleDialog.getByLabel("Verse text")).toHaveValue(
      /only born Son/u,
    );
    await expect(page).toHaveScreenshot(
      "composer-bible-verse-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page.getByRole("button", { name: "Preview moment" }).click();
    await page.getByRole("button", { name: "Close preview" }).click();

    await page.getByRole("button", { name: "Add moment" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Location/u })
      .click();
    await page.getByLabel("Place name").fill("The little beach");
    await page
      .getByRole("textbox", { name: "Details" })
      .fill("Avery finally put both feet in the water.");
    await expect(page).toHaveScreenshot("composer-place-chromium-mobile.png", {
      animations: "disabled",
      caret: "hide",
    });
    await page.getByRole("button", { name: "Preview moment" }).click();
    await expect(page).toHaveScreenshot(
      "composer-place-review-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
  },
);

test(
  "composer remains calm on a keyboard-sized phone",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-short");
    await page.setViewportSize({ width: 320, height: 350 });
    await page.goto("/family");
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("button", { name: "Add moment" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Location/u })
      .click();
    await page.getByLabel("Place name").fill("The little beach");
    await page.locator(".composer-sheet").evaluate((sheet) => {
      sheet.scrollTop = 0;
    });
    await expect
      .poll(() =>
        page.locator(".composer-sheet").evaluate((sheet) => sheet.scrollTop),
      )
      .toBe(0);
    await expect(page).toHaveScreenshot("composer-place-short.png", {
      animations: "disabled",
      caret: "hide",
    });
  },
);

test(
  "private moment detail visuals stay quiet and count-free",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/family");
    await page.evaluate(() => document.fonts.ready);

    const photo = page.locator('[data-moment-kind="photo"]').first();
    await photo.getByRole("button", { name: /Respond to/u }).click();
    await expect(page).toHaveScreenshot(
      "moment-detail-photo-response-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close moment details" })
      .click();

    const thought = page.locator('[data-moment-kind="thought"]').first();
    await thought.getByRole("button", { name: /Open private notes/u }).click();
    await expect(page).toHaveScreenshot(
      "moment-detail-thought-notes-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close moment details" })
      .click();

    const location = page.locator('[data-moment-kind="location"]').first();
    await location.getByRole("button", { name: /Open private notes/u }).click();
    await expect(page).toHaveScreenshot(
      "moment-detail-location-notes-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close moment details" })
      .click();

    const milestone = page.locator('[data-moment-kind="milestone"]').first();
    await milestone.getByRole("button", { name: /Respond to/u }).click();
    await expect(page).toHaveScreenshot(
      "moment-detail-milestone-response-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close moment details" })
      .click();

    await photo.getByRole("button", { name: /Open private notes/u }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Made me smile", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Your note to the family" })
      .fill("I want to remember how nobody was ready to leave.");
    await dialog.getByRole("button", { name: "Preview note" }).click();
    await expect(page).toHaveScreenshot(
      "moment-detail-note-preview-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
  },
);

test(
  "moment detail remains calm on a keyboard-sized phone",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-short");
    await page.setViewportSize({ width: 320, height: 350 });
    await page.goto("/family");
    await page.evaluate(() => document.fonts.ready);
    const quietMoment = page.locator('[data-moment-kind="thought"]').last();
    await quietMoment
      .getByRole("button", { name: /Open private notes/u })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Hold close", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Your note to the family" })
      .fill("The porch light, and everyone still outside.");
    await dialog.getByRole("button", { name: "Preview note" }).click();
    await expect(page).toHaveScreenshot(
      "moment-detail-short-chromium-short.png",
      { animations: "disabled", caret: "hide" },
    );
  },
);

test(
  "memory journeys preserve the timeline identity",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    for (const [path, name] of [
      ["/memories", "memories-landing-chromium-mobile.png"],
      ["/memories/on-this-day", "memories-on-this-day-chromium-mobile.png"],
      ["/memories/milestones", "memories-milestones-chromium-mobile.png"],
      ["/memories/years/2023", "memories-year-chromium-mobile.png"],
      ["/quality/memories-empty", "memories-empty-chromium-mobile.png"],
    ] as const) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(name, {
        fullPage: true,
        animations: "disabled",
      });
    }
  },
);

test(
  "Memories landing remains inviting on a short phone",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-short");
    await page.goto("/memories");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(
      "memories-landing-viewport-chromium-short.png",
      { animations: "disabled" },
    );
  },
);

test(
  "family access and invitation previews stay calm and explicit",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/settings/family");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("family-settings-chromium-mobile.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });

    await page.getByRole("button", { name: "Review access for Molly" }).click();
    await expect(page).toHaveScreenshot(
      "family-settings-access-review-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
    await page.getByRole("button", { name: "Close review" }).click();

    await page
      .getByRole("textbox", { name: "Email address" })
      .fill("relative@example.com");
    await page.getByRole("button", { name: "Review invitation" }).click();
    await expect(page).toHaveScreenshot(
      "family-settings-invite-review-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
  },
);

test(
  "video feasibility stays isolated and quiet",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile");
    await page.goto("/quality/video-feasibility");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot(
      "video-feasibility-chromium-mobile.png",
      { animations: "disabled" },
    );
    await page.getByRole("button", { name: "Try a short video" }).click();
    await expect(page).toHaveScreenshot(
      "video-feasibility-dialog-chromium-mobile.png",
      { animations: "disabled", caret: "hide" },
    );
  },
);

test(
  "family invitation review stays usable with the software keyboard",
  { tag: "@visual" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-short");
    await page.setViewportSize({ width: 320, height: 350 });
    await page.goto("/settings/family#invite");
    await page.evaluate(() => document.fonts.ready);
    const input = page.getByRole("textbox", { name: "Email address" });
    await input.scrollIntoViewIfNeeded();
    await input.fill("relative@example.com");
    await page.getByRole("button", { name: "Review invitation" }).click();
    await expect(page).toHaveScreenshot(
      "family-settings-invite-short-chromium-short.png",
      { animations: "disabled", caret: "hide" },
    );
  },
);
