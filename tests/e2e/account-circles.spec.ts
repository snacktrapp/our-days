import { expect, test } from "./test";

test("compact directory keeps circle and member actions aligned", async ({
  page,
}, testInfo) => {
  for (const theme of ["dark", "light"]) {
    await page.goto("/circles?name=Friends");
    await expect(page.locator(".circle-directory-heading")).toHaveCount(2);
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: `/tmp/circles-compact-${theme}-${testInfo.project.name}.png`,
    });
    const heading = page.locator(".circle-directory-heading").first();
    expect((await heading.boundingBox())!.height).toBeLessThan(100);
    await page.getByRole("button", { name: /All our days/ }).click();
    for (const row of await page.locator(".access-list > li").all()) {
      expect((await row.boundingBox())!.height).toBeLessThan(90);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/circles-compact-expanded-${theme}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Review access for Molly" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `/tmp/circles-compact-sheet-${theme}-${testInfo.project.name}.png`,
    });
    await page.getByRole("button", { name: "Close management" }).click();
  }
});

test("Account and Circles share the Journal's flat surfaces in both themes", async ({
  page,
}, testInfo) => {
  for (const theme of ["dark", "light"]) {
    for (const [name, path, ready] of [
      ["journal", "/family", ".moment-card"],
      ["account", "/settings/family", ".profile-color-preview"],
      ["circles", "/circles", ".circle-directory-heading"],
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
    page.locator(".circle-accordion-trigger").first(),
  ).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({
    path: "/tmp/our-days-circles-directory.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("link", { name: "Manage circles", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open All our days circle feed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All our days/ }).click();
  await expect(
    page.getByRole("link", { name: "Molly View journal" }),
  ).toBeVisible();
  const settings = page.getByRole("region", { name: "Circle settings" });
  await page.screenshot({
    path: `/tmp/our-days-circles-expanded-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.locator(".circle-settings-disclosure > summary").click();
  await expect(
    settings.getByRole("button", { name: "Delete circle" }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Delete circle" }).click();
  await expect(settings.locator(".settings-review-actions")).toBeVisible();
  await settings.getByRole("button", { name: "Cancel" }).click();
  await settings.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/tmp/our-days-circle-settings-${test.info().project.name}.png`,
  });
  await page.getByRole("button", { name: /All our days/ }).click();
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
  await expect(page).toHaveURL(/\/circles\?inviteCircle=created/);
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
  await expect(page).toHaveURL(/\/circles\?inviteCircle=created/);
  await expect(
    page.getByRole("button", { name: /Friends.*1 person/ }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("person management stays in a dismissible sheet without moving the circle", async ({
  page,
}, testInfo) => {
  await page.goto("/circles");
  await page.getByRole("button", { name: /All our days/ }).click();
  const trigger = page.getByRole("button", { name: "Review access for Molly" });
  await trigger.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Molly/ })).toBeVisible();
  const bounds = await page.locator(".circle-management-sheet").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
  await page.screenshot({
    path: `/tmp/circles-person-sheet-${testInfo.project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Close management" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(
    3,
  );
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

test("old management links open the same circle on Circles", async ({
  page,
}) => {
  await page.goto("/circles/manage?inviteCircle=created&name=Friends");
  await expect(page).toHaveURL(/\/circles\?inviteCircle=created&name=Friends/);
  await expect(
    page.getByRole("button", { name: /Friends.*1 person/ }),
  ).toHaveAttribute("aria-expanded", "true");
});
