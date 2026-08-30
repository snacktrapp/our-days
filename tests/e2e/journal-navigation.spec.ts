import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

test("route-based journal navigation preserves the approved views", async ({
  page,
}) => {
  await page.goto("/family");
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Timeline view" })
      .getByRole("link", { name: "Family", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-moment-kind]")).toHaveCount(4);

  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "Our people" })).toBeVisible();

  await page.getByRole("link", { name: /Molly.*View journal/ }).click();
  await expect(page).toHaveURL(/\/people\/molly$/);
  await expect(
    page.getByRole("heading", { name: "Molly’s days" }),
  ).toBeVisible();
  await expect(page.locator("[data-moment-kind]")).toHaveCount(2);
  await expect(
    page
      .getByRole("group", { name: "Timeline view" })
      .getByRole("link", { name: "Molly", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page).toHaveURL(/\/people$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/people\/molly$/);

  await page.getByRole("link", { name: "Memories" }).click();
  await expect(page.getByRole("heading", { name: "Memories" })).toBeVisible();
  await expect(page.getByText("On this day")).toBeVisible();
});

test("primary screens and composer states have no serious axe violations", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const scan = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  };

  for (const path of ["/family", "/people/molly", "/people", "/memories"]) {
    await page.goto(path);
    await scan();
  }

  await page.goto("/family");
  await page.getByRole("button", { name: "Add moment" }).click();
  await scan();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "A thought A few words to keep", exact: true })
    .click();
  await scan();
});
