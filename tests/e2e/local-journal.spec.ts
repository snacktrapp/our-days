import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  localAlexPersonId,
  localJordanPersonId,
} from "../../src/lib/local-journal/ids";

async function jpegFixture() {
  const directory = mkdtempSync(join(tmpdir(), "our-days-photo-"));
  const path = join(directory, "porch.jpg");
  writeFileSync(
    path,
    await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 196, g: 122, b: 88 },
      },
    })
      .jpeg()
      .toBuffer(),
  );
  return path;
}

test("sign in, write a moment, attach media, and browse by date", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Open your family journal." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toHaveAttribute("href", "/api/auth/oauth/google");
  await expect(
    page.getByRole("link", { name: "Sign in with X" }),
  ).toHaveAttribute("href", "/api/auth/oauth/x");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("button", { name: "Add moment" })).toBeVisible();

  await page.getByRole("button", { name: "Add moment" }).click();
  await page
    .getByRole("button", { name: "Written entry Text, date, and details" })
    .click();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("Casey left a pebble on the porch.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("Casey left a pebble on the porch."),
  ).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Add moment" }).click();
  await page
    .getByRole("button", { name: "Photo or video Media with date and note" })
    .click();
  await page.locator('input[type="file"]').setInputFiles(await jpegFixture());
  await expect(
    page.getByText("Photo ready to upload privately."),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Note" }).fill("The last warm hour.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("The last warm hour."),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-moment-kind="photo"]').first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add moment" }).click();
  await page
    .getByRole("button", { name: "Photo or video Media with date and note" })
    .click();
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/synthetic-short.mp4");
  await expect(page.getByText("Video ready to upload privately.")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("textbox", { name: "Note" }).fill("A one-second wave.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("A one-second wave."),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-moment-kind="video"]').first(),
  ).toBeVisible();

  await page.goto("/memories");
  await expect(page.getByText("On this day", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "This date across years" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Browse memories from \d{4}/u })
    .first()
    .click();
  await expect(
    page.getByText("Casey left a pebble on the porch."),
  ).toBeVisible();

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  await expect(manifest.json()).resolves.toMatchObject({
    name: "Our Days",
    display: "standalone",
    start_url: "/",
  });
});

test("Just Me stays on the author's journal and off Family", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("button", { name: "Add moment" })).toBeVisible();

  await page.getByRole("button", { name: "Add moment" }).click();
  await page
    .getByRole("button", { name: "Written entry Text, date, and details" })
    .click();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("A porch thought just for me.");
  await page.getByRole("button", { name: /Details/u }).click();
  await page.getByRole("radio", { name: "Just Me" }).click();
  await expect(
    page.getByRole("button", { name: /Alex · You/u }),
  ).toBeDisabled();
  await expect(page.getByText("Who else was part of this?")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/people/${localAlexPersonId}`));
  await expect(
    page
      .getByLabel("Chronological moments for Alex")
      .getByText("A porch thought just for me."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".just-me-pill")).toHaveText("Just Me");

  await page.goto("/family");
  await expect(page.getByLabel("Chronological family moments")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("A porch thought just for me."),
  ).toHaveCount(0);

  await page.goto(`/people/${localJordanPersonId}`);
  await expect(page.getByLabel("Chronological moments for Jordan")).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.getByText("A porch thought just for me.")).toHaveCount(0);
});

test("unconfigured Google and X stay on the invitation gate", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toBeVisible();
  await page.goto("/api/auth/oauth/google");
  await expect(page).toHaveURL(/\/sign-in\?oauth=unavailable/u);
  await expect(
    page.getByText("That sign-in method is unavailable right now."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeVisible();
});
