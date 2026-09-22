import { expect, test } from "./test";

test("Account and Circles share the Journal's flat surfaces in both themes", async ({
  page,
}, testInfo) => {
  for (const theme of ["dark", "light"]) {
    for (const [name, path, ready] of [
      ["journal", "/family", ".moment-card"],
      ["account", "/settings/family", ".profile-color-preview"],
      ["circles", "/circles", ".circle-directory-heading"],
      ["manage", "/circles/manage", ".circles-section"],
    ]) {
      await page.goto(path);
      await expect(page.locator(ready).first()).toBeVisible();
      if (name !== "journal") {
        expect(await page.locator("main").innerText()).not.toMatch(
          /\b(family|relatives?)\b/i,
        );
      }
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const surface of await page
        .locator(".settings-section, .timeline .moment-card")
        .all()) {
        await expect(surface).toHaveCSS("border-top-width", "0px");
        await expect(surface).toHaveCSS("border-top-left-radius", "0px");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/our-days-${name}-${theme}-${testInfo.project.name}.png`,
      });
    }
  }
});

test("Account is personal; circle creation and management live under Circles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/settings/family");
  await expect(page.locator(".profile-color-preview")).toBeVisible();
  await expect(page.locator(".profile-color-disclosure")).not.toHaveAttribute(
    "open",
  );
  await expect(page.getByText("Create a circle", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "/tmp/our-days-account-collapsed.png",
    fullPage: true,
  });
  await expect(page.getByText(/manage their people in Circles/)).toHaveCount(0);
  const colorSummary = page.locator(".profile-color-disclosure > summary");
  await expect(colorSummary).toHaveCSS("list-style-type", "none");
  await expect(colorSummary.locator(".circle-accordion-chevron")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Circles", exact: true })
    .click();
  await expect(page).toHaveURL(/\/circles$/);
  await expect(
    page.locator(".circle-people-disclosure").first(),
  ).not.toHaveAttribute("open");
  await page.screenshot({
    path: "/tmp/our-days-circles-directory.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Manage circles", exact: true }).click();
  await expect(page).toHaveURL(/\/circles\/manage$/);
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Circles" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".circles-create-section")).not.toHaveAttribute(
    "open",
  );
  await page.getByText("Create a circle", { exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await page.getByLabel("Name", { exact: true }).fill("Friends");
  await page
    .getByRole("button", { name: "Create circle", exact: true })
    .click();
  await expect(page).toHaveURL(/\/circles\/manage\?inviteCircle=created/);
  await expect(
    page.getByRole("button", { name: /Friends.*1 person/ }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("old circle invitation links reach circle management", async ({
  page,
}) => {
  await page.goto("/settings/family?inviteCircle=created&name=Friends");
  await expect(page).toHaveURL(/\/circles\/manage\?inviteCircle=created/);
  await expect(
    page.getByRole("button", { name: /Friends.*1 person/ }),
  ).toHaveAttribute("aria-expanded", "true");
});
