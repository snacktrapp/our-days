import { expect, test } from "./test";

test("existing-member picker fits phone layouts in both themes", async ({
  page,
}) => {
  await page.goto(
    "/settings/family?inviteCircle=created&name=Home%20%2B%20Grandparents",
  );
  const panel = page
    .locator(".add-existing-member")
    .filter({ has: page.getByText("Add from an existing circle") });
  await panel.locator("summary").click();
  await panel.getByLabel("From circle").selectOption("family");
  const person = panel.getByLabel("Person");
  await expect(person).toBeVisible();
  await person.selectOption({ label: "Molly" });
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/our-days-add-member-${theme}.png` });
  }
  await panel
    .getByRole("button", { name: "Add to Home + Grandparents" })
    .click();
  await expect(panel.getByRole("status")).toHaveText(
    "Preview only. No membership was changed.",
  );
});
