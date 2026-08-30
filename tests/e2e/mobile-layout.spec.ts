import { expect, test } from "./test";

const routes = [
  "/family",
  "/people/molly",
  "/people/brian",
  "/people/avery",
  "/people/sam",
  "/people/june",
  "/people",
  "/settings/family",
  "/memories",
  "/memories/on-this-day",
  "/memories/years/2023",
  "/quality/memories-empty",
  "/quality/video-feasibility",
];

for (const route of routes) {
  test(`${route} reflows without horizontal overflow or undersized actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(route);

    const layout = await page.evaluate(() => {
      const buttonsAndLinks = [
        ...document.querySelectorAll<HTMLElement>("button, a[href]"),
      ]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label:
              element.getAttribute("aria-label") ?? element.textContent?.trim(),
            width: rect.width,
            height: rect.height,
          };
        });
      return {
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        undersized: buttonsAndLinks.filter(
          ({ width, height }) => width < 44 || height < 44,
        ),
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.undersized).toEqual([]);
  });
}

test("reduced-motion preference removes entrance animations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/family");
  const animationNames = await page
    .locator(".moment-card")
    .evaluateAll((cards) =>
      cards.map((card) => getComputedStyle(card).animationName),
    );
  expect(animationNames.every((name) => name === "none")).toBe(true);
  await page.getByRole("button", { name: "Add moment" }).click();
  await expect(page.locator(".composer-sheet")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("maximum-length family names stay bounded beside the mobile timeline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  const geometry = await page
    .locator(".moment-meta strong")
    .first()
    .evaluate((element) => {
      element.textContent = "A".repeat(80);
      const label = element.getBoundingClientRect();
      const stage = document
        .querySelector(".phone-stage")!
        .getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        clipped: element.scrollWidth > element.clientWidth,
        documentFits:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        insideStage: label.right <= stage.right,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
      };
    });

  expect(geometry).toMatchObject({
    clipped: true,
    documentFits: true,
    insideStage: true,
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
});

test("maximum-length family names wrap inside the Memories portal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/memories");
  const geometry = await page
    .locator(".memory-feature h3")
    .evaluate((heading) => {
      heading.textContent = "A".repeat(80);
      const label = heading.getBoundingClientRect();
      const feature = heading
        .closest(".memory-feature")!
        .getBoundingClientRect();
      const style = getComputedStyle(heading);
      return {
        documentFits:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        insideFeature: label.right <= feature.right,
        overflowWrap: style.overflowWrap,
        textFits: heading.scrollWidth <= heading.clientWidth,
      };
    });

  expect(geometry).toEqual({
    documentFits: true,
    insideFeature: true,
    overflowWrap: "anywhere",
    textFits: true,
  });
});

test("deep memory actions can scroll above the fixed navigation", async ({
  page,
}) => {
  for (const path of ["/memories/on-this-day", "/memories/years/2023"]) {
    await page.goto(path);
    const action = page
      .locator("[data-moment-kind]")
      .last()
      .getByRole("button", { name: /notes/u });
    await action.focus();
    await action.evaluate((element) =>
      element.scrollIntoView({ block: "end", behavior: "instant" }),
    );
    const geometry = await action.evaluate((element) => {
      const actionRect = element.getBoundingClientRect();
      const navigationRect = document
        .querySelector(".bottom-nav")!
        .getBoundingClientRect();
      return {
        actionBottom: actionRect.bottom,
        navigationTop: navigationRect.top,
      };
    });
    expect(geometry.actionBottom).toBeLessThanOrEqual(
      geometry.navigationTop - 4,
    );
  }
});

test("200 percent zoom-equivalent viewport retains one-dimensional reflow", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "chromium-mobile",
  );
  // Browser zoom halves the CSS-pixel viewport. A 640×450 layout viewport is
  // the deterministic reflow equivalent of a 1280×900 window at 200% zoom;
  // the real headed-browser zoom check remains a release gate.
  await page.setViewportSize({ width: 640, height: 450 });
  for (const route of [
    "/family",
    "/memories/on-this-day",
    "/memories/years/2023",
    "/settings/family",
  ]) {
    await page.goto(route);
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  }

  await page.goto("/family");
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Add moment" }).click();
  const dialog = page.getByRole("dialog");
  const photoChoice = page.getByRole("button", { name: /^Photo/u });
  await expect(dialog).toBeVisible();

  const dialogGeometry = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dialogGeometry.scrollWidth).toBeLessThanOrEqual(
    dialogGeometry.clientWidth,
  );

  await photoChoice.scrollIntoViewIfNeeded();
  await expect(photoChoice).toBeInViewport({ ratio: 1 });
});
