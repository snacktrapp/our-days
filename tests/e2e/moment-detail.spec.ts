import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";

function firstPhoto(page: Page) {
  return page.locator('[data-moment-kind="photo"]').first();
}

test("post location pin and conversation share the intended alignment", async ({
  page,
}, testInfo) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const circle = card.locator(".connection .audience-chip");
  await expect(circle).toBeVisible();
  await expect(card.locator(".card-top-chrome .post-participants")).toHaveText(
    "with Molly + 3",
  );
  await expect(card.locator(".soft-actions .tagged")).toHaveCount(0);
  const chipBox = (await circle.boundingBox())!;
  const avatarBox = (await card
    .locator(".connection .avatar-node")
    .boundingBox())!;
  expect(chipBox.x + chipBox.width).toBeLessThan(avatarBox.x);
  expect(
    Math.abs(
      chipBox.y + chipBox.height / 2 - (avatarBox.y + avatarBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  const typography = await card.evaluate((element) =>
    [".post-author > strong", ".post-author-place", ".post-participants"].map(
      (selector) => {
        const style = getComputedStyle(element.querySelector(selector)!);
        return {
          family: style.fontFamily,
          size: style.fontSize,
          weight: style.fontWeight,
        };
      },
    ),
  );
  expect(new Set(typography.map((style) => style.family)).size).toBe(1);
  expect(new Set(typography.map((style) => style.size)).size).toBe(1);
  expect(typography.map((style) => style.weight)).toEqual([
    "500",
    "400",
    "400",
  ]);
  await expect(
    card.locator(".post-author-place .moment-place-pin"),
  ).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const edges = await card.evaluate((element) => {
      const left = (selector: string) =>
        element.querySelector(selector)!.getBoundingClientRect().left;
      return {
        action: left(".quick-reaction-trigger .heart-glyph"),
        summary: left(".inline-reaction-summary"),
        commentButton: left(".note-action-trigger svg"),
        comments: left(".inline-note-summary li"),
      };
    });
    expect(edges.summary).toBeGreaterThan(edges.action + 22);
    expect(edges.action).toBeGreaterThan(edges.commentButton);
    const icons = await card.evaluate((element) =>
      [".note-action-trigger svg", ".quick-reaction-trigger svg"].map(
        (selector) => {
          const svg = element.querySelector<SVGSVGElement>(selector)!;
          const path = svg.querySelector("path")!;
          const box = path.getBBox();
          const scale =
            svg.getBoundingClientRect().height / svg.viewBox.baseVal.height;
          return {
            drawnHeight:
              (box.height +
                Number.parseFloat(getComputedStyle(svg).strokeWidth)) *
              scale,
            height: svg.getBoundingClientRect().height,
          };
        },
      ),
    );
    expect(icons[0].height).toBeCloseTo(icons[1].height, 2);
    expect(Math.abs(icons[0].drawnHeight - icons[1].drawnHeight)).toBeLessThan(
      0.5,
    );
    expect(Math.abs(edges.commentButton - edges.comments)).toBeLessThanOrEqual(
      1,
    );
    await expect(card.locator(".inline-conversation")).toHaveCSS(
      "padding-bottom",
      "16px",
    );
    await card
      .locator(".card-copy")
      .screenshot({ path: testInfo.outputPath(`post-inset-${theme}.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    const clip = await card.evaluate((element) => ({
      x: 0,
      y: element.getBoundingClientRect().top + window.scrollY,
      width: window.innerWidth,
      height: element.getBoundingClientRect().height,
    }));
    await page.screenshot({
      fullPage: true,
      clip,
      path: testInfo.outputPath(`post-context-${theme}.png`),
    });
  }
});

test("long reaction names wrap without moving the buttons", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/family");
  const card = firstPhoto(page);
  const comment = card.locator(".note-action-trigger");
  const heart = card.locator(".quick-reaction-trigger");
  const before = [await comment.boundingBox(), await heart.boundingBox()];
  await card
    .locator(".inline-reaction-summary li span")
    .last()
    .evaluate((element) => {
      element.textContent =
        "Alexandria, Christopher, Charlotte, Benjamin, Eleanor, Theodore, Elizabeth, Nathaniel";
    });
  expect([await comment.boundingBox(), await heart.boundingBox()]).toEqual(
    before,
  );
  const overflow = await card
    .locator(".soft-actions")
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await expect(
    card.locator(".inline-reaction-summary .heart-glyph"),
  ).toHaveCount(0);
});

test("inline comments stay unboxed in both themes", async ({ page }) => {
  await page.goto("/family");
  const comment = firstPhoto(page).locator(".inline-note-summary li").first();
  await expect(comment).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(comment).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const side of ["top", "right", "bottom", "left"]) {
      await expect(comment).toHaveCSS(`border-${side}-width`, "0px");
    }
    await expect(comment.locator(".note-avatar")).toHaveCount(0);
    const dot = comment.locator(".comment-color-dot");
    await expect(dot).toHaveCSS("width", "8px");
    await expect(dot).toHaveCSS("height", "8px");
    await expect(dot).toHaveCSS("border-radius", "50%");
    await expect(dot).toBeEmpty();
    await expect(dot).toHaveAttribute("aria-hidden", "true");
    await expect(dot).toHaveCSS(
      "background-color",
      await firstPhoto(page)
        .locator(".post-author-avatar")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    await expect(comment.locator("strong")).toBeVisible();
    await expect(comment.locator("p")).toBeVisible();
  }
});

async function openNoteForm(page: Page, card: Locator = firstPhoto(page)) {
  const trigger = card.getByRole("button", { name: /Add a note to/u });
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      () => {
        document.documentElement.dataset.commentFocusedDuringTap = String(
          document.activeElement?.matches(".comment-dialog textarea") ?? false,
        );
      },
      { once: true },
    );
  });
  await trigger.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-comment-focused-during-tap",
    "true",
  );
  const form = page
    .getByRole("dialog", { name: "Add comment" })
    .locator("form");
  await expect(form).toBeVisible();
  return { form, trigger };
}

test("tapping comments expands inline without opening the composer", async ({
  page,
}) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const { form } = await openNoteForm(page, card);
  await form.getByRole("textbox").fill("Another memory from this day.");
  await form.getByRole("button", { name: "Post", exact: true }).click();
  const comments = card.getByRole("list", { name: "Notes from family" });
  await expect(comments.locator("li")).toHaveCount(2);
  await comments.locator("p").first().tap();
  await expect(comments.locator("li")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await comments.locator("p").first().tap();
  await expect(comments.locator("li")).toHaveCount(3);
  await card.getByRole("button", { name: "Show fewer notes" }).click();
  await expect(comments.locator("li")).toHaveCount(2);
  await comments.tap({ position: { x: 2, y: 2 } });
  await expect(comments.locator("li")).toHaveCount(3);
});

test("one-tap love is salmon, names share actions, comments follow", async ({
  page,
}) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const trigger = card.getByRole("button", { name: /Love photo/u });
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("menu")).toHaveCount(0);
  const rows = await card.evaluate((el) => {
    const summary = el.querySelector(".inline-reaction-summary")!;
    const actions = el.querySelector(".soft-actions")!;
    const notes = el.querySelector(".inline-note-summary")!;
    return {
      order:
        Boolean(
          el
            .querySelector(".quick-reaction-trigger")!
            .compareDocumentPosition(summary) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ) &&
        Boolean(
          actions.compareDocumentPosition(notes) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      heart: getComputedStyle(el.querySelector(".heart-glyph")!).color,
      salmon: getComputedStyle(el).getPropertyValue("--clay").trim(),
    };
  });
  expect(rows.order).toBe(true);
  const expectedColor = await trigger.evaluate((el) => {
    const span = document.createElement("span");
    span.style.color = "var(--clay)";
    el.append(span);
    const color = getComputedStyle(span).color;
    span.remove();
    return color;
  });
  expect(rows.heart).toBe(expectedColor);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
});

test("photo double-tap loves without opening media and never toggles off", async ({
  page,
}) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const photo = card.locator(".double-tap-photo");
  const trigger = card.getByRole("button", { name: /Love photo/u });
  await photo.scrollIntoViewIfNeeded();
  const box = (await photo.boundingBox())!;
  const tap = () => page.touchscreen.tap(box.x + 100, box.y + 100);
  await tap();
  await tap();
  await expect(trigger).toHaveAttribute("aria-pressed", "true");
  await tap();
  await tap();
  await expect(trigger).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("carousel swipes still change photos without loving the post", async ({
  page,
}) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const pager = card.locator(".photo-card-pager");
  await pager.scrollIntoViewIfNeeded();
  await pager.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2;
    for (const [type, clientX] of [
      ["pointerdown", x],
      ["pointermove", x - 90],
      ["pointerup", x - 90],
    ] as const) {
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          isPrimary: true,
          pointerId: 7,
          pointerType: "touch",
          clientX,
          clientY: box.top + 30,
        }),
      );
    }
  });
  await expect(pager.getByText("Photo 2 of 3")).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: /Love photo/u }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("reduced motion suppresses the heart animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/family");
  const card = firstPhoto(page);
  await card
    .locator(".double-tap-photo")
    .dblclick({ position: { x: 100, y: 100 } });
  await expect(
    card.getByRole("button", { name: /Love photo/u }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator(".post-love-burst")).toBeHidden();
});

test("comment drawer drafts save safely and remain reversible", async ({
  page,
}) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const { form, trigger } = await openNoteForm(page, card);
  const note = form.getByRole("textbox", { name: "Add a family note" });
  await expect(note).toBeFocused();
  await expect(form.getByRole("button", { name: "Post" })).toBeDisabled();

  const hostileNote =
    '<img data-detail-injection src=x onerror="window.__detailInjected=true"> A safe family note';
  await note.fill(hostileNote);
  await form.getByRole("button", { name: "Post" }).click();
  await expect(form).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(card.getByText(hostileNote, { exact: true })).toBeVisible();
  await expect(
    card.getByText("The quiet ride home was my favorite part.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: /Show 1 more/u }).click();
  await expect(
    card.getByText("The quiet ride home was my favorite part.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.locator("[data-detail-injection]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __detailInjected?: boolean })
          .__detailInjected,
    ),
  ).toBeUndefined();
  const reopened = await openNoteForm(page, card);
  await reopened.form
    .getByRole("textbox", { name: "Add a family note" })
    .fill("Discard this draft");
  await reopened.form.getByRole("button", { name: "Cancel" }).click();
  await expect(reopened.form).toBeHidden();
  await expect(card.getByText("Discard this draft")).toHaveCount(0);
});

test("comment drawer preserves dismissed drafts and the timeline position", async ({
  page,
}) => {
  await page.goto("/family");
  const trigger = firstPhoto(page).getByRole("button", {
    name: /Add a note to/u,
  });
  await trigger.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Add comment" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await dialog.getByRole("textbox").fill("Keep my draft");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - before),
  ).toBeLessThanOrEqual(2);
  await trigger.click();
  await expect(dialog.getByRole("textbox")).toHaveValue("Keep my draft");
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog.getByRole("textbox")).toHaveValue("Keep my draft");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("comment drawer follows the keyboard viewport and keeps Post readable", async ({
  page,
}) => {
  await page.goto("/family");
  const { form } = await openNoteForm(page);
  await form.getByRole("textbox").fill("Ready to post");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const colors = await form
      .getByRole("button", { name: "Post" })
      .evaluate((button) => {
        const style = getComputedStyle(button);
        return { color: style.color, background: style.backgroundColor };
      });
    expect(colors.color).not.toBe(colors.background);
    const result = await new AxeBuilder({ page })
      .include(".comment-dialog")
      .analyze();
    expect(
      result.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  }
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 330,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByRole("dialog")).toHaveCSS("height", "330px");
  const button = await form.getByRole("button", { name: "Post" }).boundingBox();
  expect(button!.y).toBeGreaterThanOrEqual(0);
  expect(button!.y + button!.height).toBeLessThanOrEqual(330);
});

test("preview interactions do not navigate, persist, or make requests", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "Browser inventory runs once.",
  );
  await page.goto("/family", { waitUntil: "networkidle" });
  const inventory = () =>
    page.evaluate(() => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      historyLength: history.length,
      historyState: JSON.stringify(history.state),
      url: location.href,
    }));
  const baseline = await inventory();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/u.test(request.url())) requests.push(request.url());
  });

  const card = firstPhoto(page);
  await card.getByRole("button", { name: /Love photo/u }).click();
  const { form } = await openNoteForm(page, card);
  await form
    .getByRole("textbox", { name: "Add a family note" })
    .fill("A local-only preview note");
  await form.getByRole("button", { name: "Post" }).click();

  expect(requests).toEqual([]);
  expect(await inventory()).toEqual(baseline);
});

test("inline reaction and note states have no serious accessibility findings", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "Axe coverage runs once in Chromium.",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    window.localStorage.setItem("our-days-theme", "dark");
  });
  await page.goto("/family");
  const card = firstPhoto(page);
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .exclude(".inline-reaction-summary")
      .analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  };

  await card.getByRole("button", { name: /Love photo/u }).click();
  await scan();
  await openNoteForm(page, card);
  await scan();
});

test("inline conversation controls remain reachable on a short screen", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-short",
    "The exact short-screen contract runs in its pinned project.",
  );
  await page.setViewportSize({ width: 320, height: 350 });
  await page.goto("/family");
  const { form } = await openNoteForm(page);
  const controls = form.locator("textarea, button");
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 1 });
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("personal and memory timelines use inline conversation without navigation drift", async ({
  page,
}) => {
  for (const path of [
    "/people/molly",
    "/memories/on-this-day",
    "/memories/milestones",
  ] as const) {
    await page.goto(path);
    const card = page.locator("[data-moment-kind]").first();
    const trigger = card.getByRole("button", { name: /Love /u });
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      url: location.href,
      historyLength: history.length,
      historyState: JSON.stringify(history.state),
    }));
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(() => ({
        url: location.href,
        historyLength: history.length,
        historyState: JSON.stringify(history.state),
      })),
    ).toEqual(before);
  }
});
