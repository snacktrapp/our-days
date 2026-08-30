import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

test("route-based journal navigation preserves the approved views", async ({
  page,
  allowedConsoleErrors,
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
  await expect(page.locator("[data-moment-kind]")).toHaveCount(6);

  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "Our people" })).toBeVisible();

  await page.getByRole("link", { name: /Molly.*View journal/ }).click();
  await expect(page).toHaveURL(/\/people\/molly$/);
  await expect(
    page.getByRole("heading", { name: "Molly’s days" }),
  ).toBeVisible();
  await expect(page.locator("[data-moment-kind]")).toHaveCount(3);
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
  await expect(page).toHaveTitle("Memories — Our Days");
  await expect(page.getByText("On this day")).toBeVisible();
  expect(
    await page
      .getByRole("navigation", { name: "Browse by year" })
      .getByRole("link")
      .allTextContents(),
  ).toEqual(["2026", "2023", "2022", "2019"]);

  await page
    .getByRole("link", { name: /See 3 moments from this day/u })
    .click();
  await expect(page).toHaveURL(/\/memories\/on-this-day$/u);
  await expect(page).toHaveTitle("On this day — Our Days");
  await expect(page.getByRole("heading", { name: "August 28" })).toBeVisible();
  await expect(page.locator("[data-moment-kind]")).toHaveCount(3);
  expect(
    await page
      .locator("[data-moment-kind]")
      .evaluateAll((moments) => moments.map((moment) => moment.id)),
  ).toEqual([
    "moment-sunset",
    "moment-late-summer-2022",
    "moment-porch-light-2019",
  ]);
  await expect(page.getByText("4 years earlier")).toBeVisible();
  await expect(page.getByText("3 years earlier")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Memories" }),
  ).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page.locator("[data-moment-kind]")).toHaveCount(3);
  await page.goBack();
  await expect(page).toHaveURL(/\/memories$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/memories\/on-this-day$/u);

  await page.getByRole("link", { name: /All memories/u }).click();
  await page.getByRole("link", { name: "Browse memories from 2023" }).click();
  await expect(page).toHaveURL(/\/memories\/years\/2023$/u);
  await expect(page).toHaveTitle("2023 memories — Our Days");
  await expect(page.getByRole("heading", { name: "2023" })).toBeVisible();
  await expect(page.locator('[data-moment-kind="milestone"]')).toHaveCount(1);
  await expect(page.locator(".time-rail")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "2023" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/memories$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/memories\/years\/2023$/u);

  // Streaming not-found responses surface a 404 console error in some engines
  // and no console error in others; either outcome is intentional here.
  allowedConsoleErrors.push(
    "Failed to load resource: the server responded with a status of 404",
  );
  await page.goto("/memories/years/1900");
  await expect(page).toHaveTitle("Memories — Our Days");
  await expect(
    page.getByRole("heading", { name: "That page isn’t here." }),
  ).toBeVisible();
  const robotPolicies = await page
    .locator('meta[name="robots"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("content") ?? ""),
    );
  expect(robotPolicies.length).toBeGreaterThan(0);
  expect(robotPolicies.every((policy) => policy.includes("noindex"))).toBe(
    true,
  );

  await page.goto("/memories/years/2026");
  await expect(page).toHaveTitle("2026 memories — Our Days");
  expect(
    await page
      .locator("[data-moment-kind]")
      .evaluateAll((moments) => moments.map((moment) => moment.id)),
  ).toEqual(["moment-sunset", "moment-kitchen", "moment-lake"]);
  await expect(page.getByText("2 weeks earlier")).toBeVisible();
  await expect(page.getByText("one month earlier")).toBeVisible();
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

  for (const path of [
    "/family",
    "/people/molly",
    "/people",
    "/settings/family",
    "/memories",
    "/memories/on-this-day",
    "/memories/years/2023",
    "/quality/memories-empty",
  ]) {
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
