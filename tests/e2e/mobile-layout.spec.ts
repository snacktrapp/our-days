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

test("iPhone Family feed cannot pan sideways at 1x and still allows pinch-zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");

  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const stage = document.querySelector(".phone-stage");
    const stageRect = stage?.getBoundingClientRect();
    const overflowing = [
      ...(stage?.querySelectorAll(
        ".timeline, .time-rail, .date-marker, .moment, .moment-card",
      ) ?? []),
    ]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className.toString().split(/\s+/u)[0] ?? "",
          left: rect.left,
          right: rect.right,
        };
      })
      .filter((rect) => {
        if (!stageRect) return true;
        return (
          rect.right > stageRect.right + 1 || rect.left < stageRect.left - 1
        );
      });
    const viewport =
      document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content") ?? "";
    const htmlStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    return {
      bodyOverflowX: bodyStyle.overflowX,
      bodyOverscrollX: bodyStyle.overscrollBehaviorX,
      clientWidth: root.clientWidth,
      htmlOverflowX: htmlStyle.overflowX,
      htmlOverscrollX: htmlStyle.overscrollBehaviorX,
      overflowing,
      scrollWidth: root.scrollWidth,
      stageWidth: stageRect?.width ?? 0,
      viewport,
    };
  });

  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.stageWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.overflowing).toEqual([]);
  expect(geometry.htmlOverflowX).toMatch(/^(?:clip|hidden)$/u);
  expect(geometry.bodyOverflowX).toMatch(/^(?:clip|hidden)$/u);
  expect(geometry.htmlOverscrollX).toBe("none");
  expect(geometry.bodyOverscrollX).toBe("none");
  expect(geometry.viewport).not.toMatch(/user-scalable\s*=\s*no/iu);
  expect(geometry.viewport).not.toMatch(
    /maximum-scale\s*=\s*1(?:\.0+)?(?:\s|,|$)/iu,
  );
});

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

test("moment options open as a compact popover under the trigger without inline positioning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  await page.evaluate(() => {
    const card = document.querySelector(".moment-card");
    if (!(card instanceof HTMLElement)) {
      throw new Error("Family feed did not render a moment card.");
    }
    const actions = document.createElement("div");
    actions.className = "connected-moment-actions";
    const trigger = document.createElement("button");
    trigger.className = "connected-moment-menu-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Moment options");
    trigger.textContent = "•••";
    const menu = document.createElement("div");
    menu.className = "connected-moment-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Moment options");
    menu.dataset.placement = "below";
    for (const text of ["Copy text", "Edit moment", "Move to trash"]) {
      const button = document.createElement("button");
      button.textContent = text;
      menu.append(button);
    }
    actions.append(trigger, menu);
    card.append(actions);
  });
  const menu = page.locator(".moment-card .connected-moment-menu").last();
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveAttribute("style");

  const geometry = await menu.evaluate((element) => {
    const trigger = element
      .closest(".connected-moment-actions")
      ?.querySelector("button");
    if (!(trigger instanceof HTMLElement)) {
      throw new Error("Popover is missing its three-dots trigger.");
    }
    const rect = element.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav")!.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      alignedToTrigger: Math.abs(rect.right - triggerRect.right) <= 2,
      belowTrigger: rect.top >= triggerRect.bottom - 1,
      compactWidth: rect.width < document.documentElement.clientWidth / 2,
      height: rect.height,
      insideViewport:
        rect.left >= 0 &&
        rect.right <= document.documentElement.clientWidth &&
        rect.top >= 0,
      navTop: nav.top,
      position: style.position,
      width: rect.width,
    };
  });
  expect(geometry.position).toBe("absolute");
  expect(geometry.compactWidth).toBe(true);
  expect(geometry.alignedToTrigger).toBe(true);
  expect(geometry.belowTrigger).toBe(true);
  expect(geometry.insideViewport).toBe(true);
  expect(geometry.height).toBeLessThan(200);
  expect(geometry.width).toBeLessThan(240);
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
      .getByRole("button", { name: /note/u });
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

test("primary navigation floats as a compact rounded bar above the safe area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");
  const navigation = page.locator(".bottom-nav");
  await expect(navigation).toHaveCSS("position", "fixed");
  await expect(navigation).toHaveCSS("transform", "none");

  const geometry = await navigation.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const stage = document
      .querySelector(".phone-stage")!
      .getBoundingClientRect();
    const below = document.elementFromPoint(
      rect.left + rect.width / 2,
      Math.min(window.innerHeight - 1, rect.bottom + 4),
    );
    const beside = document.elementFromPoint(
      Math.max(1, rect.left - 4),
      rect.top + rect.height / 2,
    );
    return {
      belowIsNav: Boolean(below?.closest(".bottom-nav")),
      besideIsNav: Boolean(beside?.closest(".bottom-nav")),
      bottom: style.bottom,
      bottomGap: window.innerHeight - rect.bottom,
      height: rect.height,
      leftGap: rect.left - stage.left,
      radius: Number.parseFloat(style.borderRadius),
      rightGap: stage.right - rect.right,
      stageWidth: stage.width,
      width: rect.width,
    };
  });

  expect(geometry.height).toBeLessThanOrEqual(58);
  expect(geometry.radius).toBeGreaterThanOrEqual(12);
  expect(geometry.leftGap).toBeGreaterThanOrEqual(8);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(8);
  expect(geometry.bottomGap).toBeGreaterThanOrEqual(8);
  expect(geometry.width).toBeLessThan(geometry.stageWidth);
  expect(geometry.belowIsNav).toBe(false);
  expect(geometry.besideIsNav).toBe(false);
  expect(geometry.bottom).not.toBe("0px");
});

test("touch-focused composer textareas keep content spacing without a selection ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");
  await page.getByRole("button", { name: "Add moment" }).click();
  const composer = page.getByRole("dialog");
  await composer.getByRole("button", { name: /Location/u }).click();
  const details = composer.getByRole("textbox", { name: "Details" });
  await details.fill("Vroom vroom");

  const focusedField = await details.evaluate((textarea) => {
    const style = getComputedStyle(textarea);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingTop: Number.parseFloat(style.paddingTop),
    };
  });

  await composer.getByRole("button", { name: /Details/u }).click();
  const molly = composer.getByRole("checkbox", { name: "Molly" });
  await molly.tap();
  const touchTagFocus = await molly.evaluate((input) => {
    const label = input.closest("label");
    if (!label) throw new Error("Person tag label is missing");
    const style = getComputedStyle(label);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
    };
  });
  await page.keyboard.press("Tab");
  await molly.focus();
  const keyboardTagFocus = await molly.evaluate((input) => {
    const label = input.closest("label");
    if (!label) throw new Error("Person tag label is missing");
    const style = getComputedStyle(label);
    return {
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
    };
  });

  expect(focusedField.paddingLeft).toBeGreaterThanOrEqual(12);
  expect(focusedField.paddingTop).toBeGreaterThanOrEqual(12);
  expect(focusedField.outlineStyle).toBe("none");
  expect(focusedField.boxShadow).toBe("none");
  expect(touchTagFocus.outlineStyle).toBe("none");
  expect(touchTagFocus.boxShadow).toBe("none");
  expect(keyboardTagFocus.outlineStyle).toBe("none");
  expect(keyboardTagFocus.borderColor).not.toBe("rgb(168, 82, 92)");
  expect(keyboardTagFocus.boxShadow).not.toBe("none");
});

test("real route transitions preserve the nav through every loading frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 440, height: 844 });
  await page.goto("/family");
  const navigation = page.locator(".bottom-nav");
  const navigationNode = await navigation.elementHandle();
  expect(navigationNode).not.toBeNull();

  await page.route(/\/people\?_rsc=/u, async (route) => {
    const requestUrl = new URL(route.request().url());
    requestUrl.searchParams.set("previewLoading", "navigation");
    await route.continue({ url: requestUrl.toString() });
  });

  await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>(".bottom-nav");
    if (!navigation) throw new Error("Primary navigation is missing");
    const samples: Array<{
      bottomGap: number;
      count: number;
      isOriginalNode: boolean;
      position: string;
      top: number;
    }> = [];
    const state = window as typeof window & {
      __navTransitionSamples?: typeof samples;
      __stopNavTransitionSampling?: boolean;
    };
    state.__navTransitionSamples = samples;
    state.__stopNavTransitionSampling = false;
    const sample = () => {
      const style = getComputedStyle(navigation);
      const rect = navigation.getBoundingClientRect();
      samples.push({
        bottomGap: window.innerHeight - rect.bottom,
        count: document.querySelectorAll(".bottom-nav").length,
        isOriginalNode: navigation === document.querySelector(".bottom-nav"),
        position: style.position,
        top: rect.top,
      });
      if (!state.__stopNavTransitionSampling) requestAnimationFrame(sample);
    };
    sample();
  });

  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "People" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "People" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Opening your family’s days…")).toBeVisible();
  await expect(page.locator(".journal-loading .date-marker")).toHaveText(
    /opening your family’s days/iu,
  );
  await expect(page).toHaveURL(/\/people$/u);
  await expect(page.getByRole("heading", { name: "Our people" })).toBeVisible();
  const samples = await page.evaluate(() => {
    const state = window as typeof window & {
      __navTransitionSamples?: Array<{
        bottomGap: number;
        count: number;
        isOriginalNode: boolean;
        position: string;
        top: number;
      }>;
      __stopNavTransitionSampling?: boolean;
    };
    state.__stopNavTransitionSampling = true;
    return state.__navTransitionSamples ?? [];
  });

  expect(samples.length).toBeGreaterThan(10);
  expect(samples.every(({ count }) => count === 1)).toBe(true);
  expect(samples.every(({ isOriginalNode }) => isOriginalNode)).toBe(true);
  expect(samples.every(({ position }) => position === "fixed")).toBe(true);
  expect(
    Math.max(...samples.map(({ top }) => top)) -
      Math.min(...samples.map(({ top }) => top)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...samples.map(({ bottomGap }) => bottomGap)) -
      Math.min(...samples.map(({ bottomGap }) => bottomGap)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.min(...samples.map(({ bottomGap }) => bottomGap)),
  ).toBeGreaterThanOrEqual(8);
  expect(
    await navigationNode!.evaluate(
      (element) =>
        element.isConnected &&
        element === document.querySelector(".bottom-nav"),
    ),
  ).toBe(true);
});

test("primary navigation remains above every secondary page canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/people", "/memories", "/settings/family"]) {
    await page.goto(path);
    const panel = page.locator(
      path === "/settings/family" ? ".family-settings-panel" : ".section-panel",
    );
    await expect(panel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(panel).toHaveCSS("border-top-width", "0px");
    if (path === "/settings/family") {
      await expect(panel).toHaveCSS("min-height", "0px");
    }

    for (const scrollY of [
      0,
      await page.evaluate(() => document.body.scrollHeight),
    ]) {
      await page.evaluate(
        (nextScrollY) => window.scrollTo(0, nextScrollY),
        scrollY,
      );
      const navigationIsTopmost = await page
        .locator(".bottom-nav")
        .evaluate((navigation) => {
          const rect = navigation.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + 2,
          );
          return hit === navigation || Boolean(hit?.closest(".bottom-nav"));
        });
      expect(navigationIsTopmost).toBe(true);
    }
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
