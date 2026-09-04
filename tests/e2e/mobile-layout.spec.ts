import type { Locator } from "@playwright/test";
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

async function expectFrostedNavPill(pill: Locator) {
  const frost = await pill.evaluate((element) => {
    const style = getComputedStyle(element);
    const color = style.backgroundColor;
    const alpha = color.startsWith("rgba(")
      ? Number.parseFloat(color.slice(color.lastIndexOf(",") + 1, -1))
      : color.startsWith("rgb(")
        ? 1
        : Number.NaN;
    const computedBlur =
      style.backdropFilter !== "none" && style.backdropFilter
        ? style.backdropFilter
        : style.getPropertyValue("-webkit-backdrop-filter");
    return {
      alpha,
      blur: computedBlur,
      isolation: style.isolation,
      tokenBlur: style.getPropertyValue("--nav-pill-blur").trim(),
    };
  });
  expect(frost.alpha).toBeGreaterThanOrEqual(0.5);
  expect(frost.alpha).toBeLessThan(1);
  if (frost.blur && /blur\(/u.test(frost.blur)) {
    expect(frost.blur).toMatch(/blur\(/u);
  } else {
    // Linux Chromium/Firefox often compute backdrop-filter as empty even
    // when the pill still uses the shared frost token.
    expect(frost.tokenBlur).toMatch(/^\d+(?:\.\d+)?px$/u);
  }
  expect(frost.isolation).not.toBe("isolate");
}

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
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: /Open notifications/u }).click();
  await expect(page.locator(".notification-panel")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.keyboard.press("Escape");
  await page.locator(".title-switcher summary").click();
  await expect(page.locator(".title-switcher nav")).toHaveCSS(
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
    const root = getComputedStyle(document.documentElement);
    const stage = getComputedStyle(document.querySelector(".phone-stage")!);
    return {
      backgroundImage: layer.backgroundImage,
      bottom: layer.bottom,
      left: layer.left,
      phoneStageBackgroundImage: stage.backgroundImage,
      position: layer.position,
      right: layer.right,
      rootBackgroundImage: root.backgroundImage,
      top: layer.top,
    };
  });

  expect(grid.position).toBe("fixed");
  expect(grid.backgroundImage).toContain("linear-gradient");
  expect(grid.rootBackgroundImage).toContain("linear-gradient");
  expect(grid.phoneStageBackgroundImage).toBe("none");
  expect(grid).toMatchObject({
    bottom: "0px",
    left: "0px",
    right: "0px",
    top: "0px",
  });
});

test("New moment type picker keeps frosted nav chrome over the grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");
  await page.getByRole("button", { name: "Add moment" }).click();
  const dialog = page.locator("dialog.new-moment-composer-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/composer-type-picker/u);
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    false,
  );
  await expectFrostedNavPill(page.locator(".topbar"));
  await expectFrostedNavPill(page.locator(".bottom-nav"));
  const slab = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav")!.getBoundingClientRect();
    return {
      alpha: style.backgroundColor.startsWith("rgba(")
        ? Number.parseFloat(
            style.backgroundColor.slice(
              style.backgroundColor.lastIndexOf(",") + 1,
              -1,
            ),
          )
        : style.backgroundColor.startsWith("rgb(")
          ? 1
          : style.backgroundColor === "transparent" ||
              style.backgroundColor === "rgba(0, 0, 0, 0)"
            ? 0
            : Number.NaN,
      backdrop: style.backdropFilter,
      bottom: rect.bottom,
      height: rect.height,
      navTop: nav.top,
    };
  });
  expect(slab.alpha).toBeLessThan(0.05);
  expect(slab.backdrop === "none" || slab.backdrop === "").toBe(true);
  expect(slab.bottom).toBeLessThan(slab.navTop);
});

test("moment options open as a compact popover under the trigger without inline positioning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  await page.evaluate(() => {
    document.getElementById("e2e-moment-options-card")?.remove();
    document.getElementById("e2e-moment-options-sheet")?.remove();
    const sheet = document.createElement("style");
    sheet.id = "e2e-moment-options-sheet";
    const nonce =
      document.querySelector<HTMLElement>("[nonce]")?.nonce ||
      document.querySelector("[nonce]")?.getAttribute("nonce") ||
      "";
    if (nonce) sheet.setAttribute("nonce", nonce);
    sheet.textContent =
      "#e2e-moment-options-card{position:fixed;top:72px;right:16px;width:220px;height:120px;z-index:40}";
    document.head.append(sheet);
    const card = document.createElement("div");
    card.id = "e2e-moment-options-card";
    card.className = "moment-card";
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
    document.body.append(card);
  });
  const menu = page.locator("#e2e-moment-options-card .connected-moment-menu");
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
      animationName: style.animationName,
      width: rect.width,
    };
  });
  expect(geometry.position).toBe("absolute");
  expect(geometry.animationName).toContain("overlay-popover-in");
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
  await expectFrostedNavPill(navigation);

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

test("top chrome floats as a compact rounded pill above the feed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");
  const header = page.locator(".topbar");
  await expect(header).toHaveCSS("position", "fixed");
  await expect(header).toHaveCSS("transform", "none");
  await expectFrostedNavPill(header);
  await expect(page.locator(".phone-stage")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(header.locator(".nav-item")).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "Add moment" }),
  ).toBeVisible();

  const geometry = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const stage = document
      .querySelector(".phone-stage")!
      .getBoundingClientRect();
    const above = document.elementFromPoint(
      rect.left + rect.width / 2,
      Math.max(1, rect.top - 4),
    );
    const beside = document.elementFromPoint(
      Math.max(1, rect.left - 4),
      rect.top + rect.height / 2,
    );
    return {
      aboveIsHeader: Boolean(above?.closest(".topbar")),
      besideIsHeader: Boolean(beside?.closest(".topbar")),
      height: rect.height,
      leftGap: rect.left - stage.left,
      radius: Number.parseFloat(style.borderRadius),
      rightGap: stage.right - rect.right,
      stageWidth: stage.width,
      top: style.top,
      topGap: rect.top,
      width: rect.width,
    };
  });

  expect(geometry.height).toBeLessThanOrEqual(58);
  expect(geometry.radius).toBeGreaterThanOrEqual(12);
  expect(geometry.leftGap).toBeGreaterThanOrEqual(8);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(8);
  expect(geometry.topGap).toBeGreaterThanOrEqual(8);
  expect(geometry.width).toBeLessThan(geometry.stageWidth);
  expect(geometry.aboveIsHeader).toBe(false);
  expect(geometry.besideIsHeader).toBe(false);
  expect(geometry.top).not.toBe("0px");

  await page.evaluate(() => window.scrollTo(0, 240));
  const afterScroll = await header.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, position: getComputedStyle(element).position };
  });
  expect(afterScroll.position).toBe("fixed");
  expect(afterScroll.top).toBeCloseTo(geometry.topGap, 0);
});

test("family title is tappable and optically centered in the top pill", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/family");
    const header = page.locator(".topbar");
    const heading = page.getByRole("heading", { name: "All our days" });
    const summary = page.locator(".title-switcher summary");
    await expect(summary).toHaveCSS("pointer-events", "auto");
    await expect(page.locator(".title-switcher")).toHaveCSS(
      "pointer-events",
      "none",
    );

    const alignment = await page.evaluate(() => {
      const bar = document.querySelector(".topbar")!;
      const title = document.querySelector(".title-switcher-heading h1")!;
      const barRect = bar.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      return {
        offset:
          (titleRect.left + titleRect.right) / 2 -
          (barRect.left + barRect.right) / 2,
        paddingInlineStart: getComputedStyle(
          document.querySelector(".title-switcher summary")!,
        ).paddingInlineStart,
      };
    });
    expect(Math.abs(alignment.offset)).toBeLessThanOrEqual(2);
    expect(alignment.paddingInlineStart).toBe("0px");

    await summary.click();
    await expect(page.locator(".title-switcher")).toHaveAttribute("open", "");
    await expect(
      page.getByRole("navigation", { name: "Choose a family timeline" }),
    ).toBeVisible();
    await heading.click();
  }
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

test("real route transitions hold the last screen and keep the nav put", async ({
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
      emptyJournal: boolean;
      familyHeld: boolean;
      isOriginalNode: boolean;
      loadingFrame: boolean;
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
        emptyJournal: Boolean(document.querySelector(".timeline-empty-state")),
        familyHeld: Boolean(
          document
            .getElementById("journal-focus-target")
            ?.textContent?.includes("All our days"),
        ),
        isOriginalNode: navigation === document.querySelector(".bottom-nav"),
        loadingFrame: Boolean(document.querySelector(".journal-loading")),
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
    .click({ noWaitAfter: true });
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "People" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "People" })
      .locator(".nav-symbol-pending"),
  ).toHaveCount(1);
  await expect(page.getByText("Opening your family’s days…")).toHaveCount(0);
  await expect(page.locator(".journal-loading")).toHaveCount(0);
  await expect(page.locator(".timeline-empty-state")).toHaveCount(0);
  await expect(page).toHaveURL(/\/people$/u);
  await expect(page.getByRole("heading", { name: "Our people" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "People" })
      .locator(".nav-symbol-pending"),
  ).toHaveCount(0);
  const samples = await page.evaluate(() => {
    const state = window as typeof window & {
      __navTransitionSamples?: Array<{
        bottomGap: number;
        count: number;
        emptyJournal: boolean;
        familyHeld: boolean;
        isOriginalNode: boolean;
        loadingFrame: boolean;
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
  expect(samples.every(({ loadingFrame }) => !loadingFrame)).toBe(true);
  expect(samples.every(({ emptyJournal }) => !emptyJournal)).toBe(true);
  expect(samples.some(({ familyHeld }) => familyHeld)).toBe(true);
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

test("a timeline photo expands over the floating header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family");
  await page.locator(".photo-viewer-trigger").first().click();
  const dialog = page.locator(".photo-lightbox");
  await expect(dialog).toBeVisible();
  const geometry = await page.evaluate(() => {
    const viewer = document.querySelector(".photo-lightbox");
    if (!(viewer instanceof HTMLElement)) return null;
    const rect = viewer.getBoundingClientRect();
    const header = document.querySelector(".topbar");
    const headerRect = header?.getBoundingClientRect();
    const headerHit =
      headerRect &&
      document.elementFromPoint(headerRect.left + 12, headerRect.top + 12);
    return {
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      coversHeader: !headerHit?.closest(".topbar"),
    };
  });
  expect(geometry?.top).toBe(0);
  expect(geometry?.width).toBe(390);
  expect(geometry?.height).toBe(844);
  expect(geometry?.coversHeader).toBe(true);
});
