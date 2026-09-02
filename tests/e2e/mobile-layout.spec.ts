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
  "/memories/milestones",
  "/memories/years/2023",
  "/quality/memories-empty",
  "/quality/video-feasibility",
  "/quality/photo-status",
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

test("the graph-paper grid is painted by a viewport-fixed layer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");

  const grid = await page.locator(".app-shell").evaluate((shell) => {
    const layer = getComputedStyle(shell, "::before");
    const stage = getComputedStyle(document.querySelector(".phone-stage")!);
    return {
      backgroundImage: layer.backgroundImage,
      bottom: layer.bottom,
      left: layer.left,
      phoneStageBackgroundImage: stage.backgroundImage,
      position: layer.position,
      right: layer.right,
      top: layer.top,
    };
  });

  expect(grid.position).toBe("fixed");
  expect(grid.backgroundImage).toContain("linear-gradient");
  expect(grid.phoneStageBackgroundImage).toBe("none");
  expect(grid).toMatchObject({
    bottom: "0px",
    left: "0px",
    right: "0px",
    top: "0px",
  });
});

test("portalled moment options stay visible above navigation without inline positioning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  await page.evaluate(() => {
    const menu = document.createElement("dialog");
    menu.className = "connected-moment-menu connected-moment-menu-portal";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Moment options");
    for (const text of ["Copy text", "Edit moment", "Move to trash"]) {
      const button = document.createElement("button");
      button.textContent = text;
      menu.append(button);
    }
    document.body.append(menu);
    menu.showModal();
  });
  const menu = page.getByRole("group", { name: "Moment options" });
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveAttribute("style");

  const geometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav")!.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      insideViewport:
        rect.left >= 0 &&
        rect.right <= document.documentElement.clientWidth &&
        rect.top >= 0,
      navTop: nav.top,
      position: getComputedStyle(element).position,
      scrollY: window.scrollY,
      top: rect.top,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.insideViewport).toBe(true);
  expect(geometry.position).toBe("fixed");
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop);
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

test("an unbroken milestone title wraps beside the timeline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/memories/milestones");
  const geometry = await page
    .locator(".milestone-copy h3")
    .evaluate((heading) => {
      heading.textContent = "M".repeat(80);
      const card = heading.closest(".moment-card")!.getBoundingClientRect();
      const label = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      return {
        documentFits:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        insideCard: label.right <= card.right,
        overflowWrap: style.overflowWrap,
        textFits: heading.scrollWidth <= heading.clientWidth,
      };
    });

  expect(geometry).toEqual({
    documentFits: true,
    insideCard: true,
    overflowWrap: "anywhere",
    textFits: true,
  });
});

test("deep memory actions can scroll above the fixed navigation", async ({
  page,
}) => {
  for (const path of [
    "/memories/on-this-day",
    "/memories/milestones",
    "/memories/years/2023",
  ]) {
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

test("primary navigation stays compact above the device safe area", async ({
  page,
}) => {
  await page.goto("/family");
  const geometry = await page.locator(".bottom-nav").evaluate((navigation) => {
    const style = window.getComputedStyle(navigation);
    return {
      height: navigation.getBoundingClientRect().height,
      paddingBottom: Number.parseFloat(style.paddingBottom),
    };
  });

  expect(geometry.height - geometry.paddingBottom).toBeLessThanOrEqual(58);
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
    "/memories/milestones",
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
