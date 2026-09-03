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
  await page.locator(".view-switch summary").click();
  await expect(
    page
      .getByRole("navigation", { name: "Choose a family timeline" })
      .getByRole("link", { name: "Family", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-moment-kind]")).toHaveCount(6);
  await expect(page.locator(".date-marker").first()).toHaveText(/today/i);
  await expect(page.locator(".elapsed-gap")).toHaveCount(0);
  await expect(
    page.getByText(
      /days earlier|one day earlier|weeks earlier|one month earlier|months earlier|years earlier|yesterday/iu,
    ),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "Our people" })).toBeVisible();

  await page.getByRole("link", { name: /Molly.*View journal/ }).click();
  await expect(page).toHaveURL(/\/people\/molly$/);
  await expect(
    page.getByRole("heading", { name: "Molly’s days" }),
  ).toBeVisible();
  await expect(page.locator("[data-moment-kind]")).toHaveCount(3);
  await page.locator(".view-switch summary").click();
  await expect(
    page
      .getByRole("navigation", { name: "Choose a family timeline" })
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

  await page.getByRole("link", { name: /View 3 entries/u }).click();
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

  // The retired milestone collection is intentionally absent from Memories;
  // keep the legacy deep link covered for existing bookmarks.
  await page.goto("/memories/milestones");
  await expect(page).toHaveURL(/\/memories\/milestones$/u);
  await expect(page).toHaveTitle("Milestones — Our Days");
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();
  await expect(page.locator("[data-moment-kind]")).toHaveCount(1);
  await expect(page.locator('[data-moment-kind="milestone"]')).toHaveCount(1);
  await expect(page.getByText("First day of school")).toBeVisible();

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
    "/people/brian",
    "/people/molly",
    "/people/avery",
    "/people/sam",
    "/people/june",
    "/people",
    "/settings/family",
    "/memories",
    "/memories/on-this-day",
    "/memories/milestones",
    "/memories/years/2023",
    "/quality/memories-empty",
    "/quality/video-feasibility",
  ]) {
    await page.goto(path);
    await scan();
  }

  await page.goto("/family");
  await page.getByRole("button", { name: "Add moment" }).click();
  await scan();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "Written entry Text, date, and details",
      exact: true,
    })
    .click();
  await scan();
});

test("appearance preference persists and the journal grid stays fixed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("our-days-theme")) {
      window.localStorage.setItem("our-days-theme", "dark");
    }
  });
  await page.goto("/family");

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/u,
  );
  await expect(
    page.locator('meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
  ).toHaveAttribute("content", "black-translucent");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Use light appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Use dark appearance" }),
  ).toBeVisible();

  const rootGrid = await page.locator(".app-shell").evaluate((shell) => {
    const layer = window.getComputedStyle(shell, "::before");
    const stage = window.getComputedStyle(
      document.querySelector(".phone-stage")!,
    );
    return {
      image: layer.backgroundImage,
      phoneStageImage: stage.backgroundImage,
      position: layer.position,
    };
  });
  expect(rootGrid.position).toBe("fixed");
  expect(rootGrid.image).not.toBe("none");
  expect(rootGrid.phoneStageImage).toBe("none");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the timeline selector scrolls beneath the sticky header", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    hasTouch: false,
    viewport: { width: 1042, height: 879 },
  });
  const page = await context.newPage();
  await page.goto("/family");

  const stage = page.locator(".phone-stage");
  const header = page.locator(".topbar");
  const selector = page.locator(".view-switch");
  await expect(selector).toBeVisible();

  await stage.evaluate((element) => {
    const topbar = element.querySelector<HTMLElement>(".topbar");
    const viewSwitch = element.querySelector<HTMLElement>(".view-switch");
    if (!topbar || !viewSwitch) return;

    const headerRect = topbar.getBoundingClientRect();
    const selectorRect = viewSwitch.getBoundingClientRect();
    element.scrollTop += selectorRect.top - headerRect.bottom + 8;
  });

  await expect
    .poll(async () => {
      const headerBottom = await header.evaluate(
        (element) => element.getBoundingClientRect().bottom,
      );
      const selectorTop = await selector.evaluate(
        (element) => element.getBoundingClientRect().top,
      );
      return selectorTop < headerBottom;
    })
    .toBe(true);

  const layering = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const viewSwitch = document.querySelector<HTMLElement>(".view-switch");
    if (!topbar || !viewSwitch) return null;

    const headerRect = topbar.getBoundingClientRect();
    const selectorRect = viewSwitch.getBoundingClientRect();
    const sampleX = selectorRect.left + selectorRect.width / 2;
    const sampleY = Math.max(
      headerRect.top + 1,
      Math.min(headerRect.bottom - 1, selectorRect.top + 1),
    );
    const topElement = document.elementFromPoint(sampleX, sampleY);

    return {
      overlaps: selectorRect.top < headerRect.bottom,
      topElementIsHeader: Boolean(topElement?.closest(".topbar")),
    };
  });

  expect(layering).toEqual({
    overlaps: true,
    topElementIsHeader: true,
  });
  await expect(header).toBeVisible();
  await context.close();
});
