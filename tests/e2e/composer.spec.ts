import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

async function setComposerPlace(scope: Page | Locator, name: string) {
  const page = "keyboard" in scope ? scope : scope.page();
  const field = scope.getByLabel("Place name");
  if (!(await field.isVisible())) {
    await scope.getByRole("button", { name: /^Place,/u }).click();
  }
  await field.fill(name);
  await page.keyboard.press("Escape");
}

async function expectReachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 1 });
}

async function expectMinimumTargets(dialog: Locator) {
  const targetSelector = [
    "button",
    'input:not([type="checkbox"]):not([type="file"])',
    "select",
    "textarea",
    ".photo-input",
    ".people-tags label",
  ].join(",");
  const undersized = await dialog
    .locator(targetSelector)
    .evaluateAll((targets) =>
      targets
        .filter((target) => {
          const rect = target.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((target) => {
          const rect = target.getBoundingClientRect();
          return {
            label:
              target.getAttribute("aria-label") || target.textContent?.trim(),
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(({ width, height }) => width < 43.9 || height < 43.9),
    );
  expect(undersized).toEqual([]);
}

async function expectReadableInputType(dialog: Locator) {
  const undersizedText = await dialog
    .locator(
      'input:not([type="checkbox"]):not([type="file"]), select, textarea',
    )
    .evaluateAll((controls) =>
      controls
        .filter((control) => control.getClientRects().length > 0)
        .map((control) => ({
          label:
            control.getAttribute("aria-label") ||
            control.parentElement?.textContent?.trim(),
          fontSize: Number.parseFloat(getComputedStyle(control).fontSize),
        }))
        .filter(({ fontSize }) => fontSize < 16),
    );
  expect(undersizedText).toEqual([]);
}

async function collectContainedFocusCycle(
  page: Page,
  dialog: Locator,
  key: "Tab" | "Shift+Tab",
) {
  const controls = dialog.locator(focusableSelector);
  const controlCount = await controls.count();
  const visited = new Set<number>();

  for (let index = 0; index < controlCount + 1; index += 1) {
    const focusState = await dialog.evaluate((element, selector) => {
      const active = document.activeElement;
      const focusableControls = [...element.querySelectorAll(selector)];
      const controlIndex = focusableControls.findIndex(
        (control) => control === active,
      );
      return {
        contained: active === element || element.contains(active),
        controlIndex,
        active:
          active instanceof HTMLElement
            ? active.getAttribute("aria-label") ||
              active.textContent?.trim() ||
              active.tagName
            : "none",
      };
    }, focusableSelector);
    expect(
      focusState.contained,
      `${key} focus escaped the modal to ${focusState.active}`,
    ).toBe(true);
    if (focusState.controlIndex >= 0) visited.add(focusState.controlIndex);
    await page.keyboard.press(key);
  }

  return visited;
}

async function expectCompleteFocusTraversal(
  page: Page,
  dialog: Locator,
  startingControl: Locator,
  stateLabel: string,
) {
  await startingControl.focus();
  const forwardFocus = await collectContainedFocusCycle(page, dialog, "Tab");
  await startingControl.focus();
  const reverseFocus = await collectContainedFocusCycle(
    page,
    dialog,
    "Shift+Tab",
  );
  const visitedControls = new Set([...forwardFocus, ...reverseFocus]);
  expect(
    [...visitedControls].sort((left, right) => left - right),
    `forward and reverse focus traversal must reach every ${stateLabel} control`,
  ).toEqual(
    Array.from(
      { length: await dialog.locator(focusableSelector).count() },
      (_, index) => index,
    ),
  );
}

async function openComposer(page: Page) {
  await page.getByRole("button", { name: "Add moment" }).click();
  return page.locator("dialog.new-moment-composer-dialog");
}

async function selectMomentDate(dialog: Locator, dateLabel: string) {
  await dialog.getByRole("button", { name: /^Moment date,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose moment date" })
    .getByRole("button", { name: dateLabel, exact: true })
    .click();
}

async function selectBiblePassage(
  dialog: Locator,
  passage: Readonly<{
    book: string;
    chapter: number;
    start: number;
    end?: number;
  }>,
) {
  await dialog.getByRole("button", { name: /^Book,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose book" })
    .getByRole("menuitemradio", { name: passage.book, exact: true })
    .click();
  await dialog.getByRole("button", { name: /^Chapter,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose chapter" })
    .getByRole("button", { name: `Chapter ${passage.chapter}` })
    .click();
  await dialog.getByRole("button", { name: /^Starting verse,/u }).click();
  await dialog
    .getByRole("dialog", { name: "Choose starting verse" })
    .getByRole("button", { name: `Starting verse ${passage.start}` })
    .click();
  if (passage.end && passage.end !== passage.start) {
    await dialog.getByRole("button", { name: /^Ending verse,/u }).click();
    await dialog
      .getByRole("dialog", { name: "Choose ending verse" })
      .getByRole("button", { name: `Ending verse ${passage.end}` })
      .click();
  }
}

test("date, time, and journal stay separated inside every phone-width drawer", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/family");
    const dialog = await openComposer(page);
    await dialog.getByRole("button", { name: /^Photo/u }).click();
    await dialog.getByRole("button", { name: /Details/u }).click();

    const geometry = await dialog.evaluate((element) => {
      const sheet = element.querySelector<HTMLElement>(".composer-sheet")!;
      const fields = element.querySelector<HTMLElement>(
        ".composer-core-fields",
      )!;
      const [date, time] = [
        ...element.querySelectorAll<HTMLElement>(".composer-picker-trigger"),
      ];
      const journal = element.querySelector<HTMLElement>(
        ".composer-journal-trigger",
      )!;
      const sheetRect = sheet.getBoundingClientRect();
      const rectangles = [date, time, journal].map((control) =>
        control.getBoundingClientRect(),
      );
      return {
        contained: rectangles.every(
          (rect) =>
            rect.left >= sheetRect.left && rect.right <= sheetRect.right,
        ),
        dateAndTimeSeparated: rectangles[0].right <= rectangles[1].left,
        journalBelow:
          Math.max(rectangles[0].bottom, rectangles[1].bottom) <=
          rectangles[2].top,
        noHorizontalOverflow:
          document.documentElement.scrollWidth <=
            document.documentElement.clientWidth &&
          sheet.scrollWidth <= sheet.clientWidth &&
          fields.scrollWidth <= fields.clientWidth,
      };
    });

    expect(geometry).toEqual({
      contained: true,
      dateAndTimeSeparated: true,
      journalBelow: true,
      noHorizontalOverflow: true,
    });
  }
});

test("composer is modal, contains focus, protects every draft, and restores focus", async ({
  page,
}) => {
  await page.goto("/family");
  await page.getByRole("button", { name: /Open notifications/u }).click();
  const notificationPanel = page.getByRole("region", {
    name: "Notifications",
  });
  await expect(notificationPanel).toBeVisible();
  const notificationTop = await notificationPanel.evaluate((element) =>
    Math.round(element.getBoundingClientRect().top),
  );
  await page.getByRole("button", { name: "Close notifications" }).click();

  const trigger = page.getByRole("button", { name: "Add moment" });
  const dialog = await openComposer(page);

  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await expect(page.getByRole("heading", { name: "New moment" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "New moment" })).toHaveCSS(
    "outline-style",
    "none",
  );
  await expect(
    page.getByText(/Local design preview · Nothing is saved/u),
  ).toHaveCount(0);
  await expect(dialog).toHaveClass(/new-moment-composer-dialog/u);
  await dialog.locator(".composer-sheet").evaluate(async (sheet) => {
    await Promise.all(
      sheet.getAnimations().map((animation) => animation.finished),
    );
  });
  const drawerPlacement = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".topbar");
    const sheet = document.querySelector<HTMLElement>(
      ".new-moment-composer-dialog .composer-sheet",
    );
    if (!header || !sheet) return null;
    const headerRect = header.getBoundingClientRect();
    const sheetRect = sheet.getBoundingClientRect();
    return {
      distanceFromHeader: Math.round(sheetRect.top - headerRect.bottom),
      opensFromTop: sheetRect.top < window.innerHeight / 2,
      top: Math.round(sheetRect.top),
    };
  });
  expect(drawerPlacement?.distanceFromHeader).toBeLessThan(0);
  expect(drawerPlacement?.opensFromTop).toBe(true);
  expect(drawerPlacement?.top).toBe(notificationTop);
  await expect(page.locator("body")).toHaveClass(/composer-scroll-locked/u);
  await expectMinimumTargets(dialog);

  let backgroundBlocked = false;
  try {
    await page
      .locator('a[href="/people"]')
      .first()
      .click({ trial: true, timeout: 500 });
  } catch {
    backgroundBlocked = true;
  }
  expect(backgroundBlocked).toBe(true);

  const firstChoice = page.getByRole("button", { name: /^Photo/u });
  await expectCompleteFocusTraversal(page, dialog, firstChoice, "chooser");

  await dialog
    .getByRole("button", {
      name: "Written entry Text, date, and details",
      exact: true,
    })
    .click();
  const text = page.getByRole("textbox", { name: "Entry" });
  await text.fill("A draft worth keeping");
  await selectMomentDate(dialog, "Aug 21, 2026");
  const journal = dialog.getByRole("button", { name: /^Journal,/u });
  await page.getByRole("button", { name: /Details/u }).click();
  await journal.click();
  await expect(
    dialog.getByRole("menuitemradio", { name: /Molly/u }),
  ).toHaveCount(0);
  await journal.click();
  const averyTag = page.getByRole("checkbox", { name: /Avery/u });
  await averyTag.check();
  await expect(averyTag).toBeChecked();
  await journal.click();
  await dialog.getByRole("menuitemradio", { name: /Avery/u }).click();
  await expect(averyTag).not.toBeChecked();
  await expect(averyTag).toBeDisabled();
  await page.getByRole("checkbox", { name: /Molly/u }).check();
  await setComposerPlace(dialog, "Oak Street School");
  await expectMinimumTargets(dialog);
  await expectReadableInputType(dialog);
  await expectCompleteFocusTraversal(
    page,
    dialog,
    text,
    "expanded written composer",
  );

  page.once("dialog", async (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Close moment composer" }).click();
  await expect(text).toHaveValue("A draft worth keeping");
  await expect(
    dialog.getByRole("button", { name: "Moment date, Aug 21, 2026" }),
  ).toBeVisible();
  await expect(journal).toHaveAccessibleName(/^Journal, Avery/u);
  await expect(page.getByRole("checkbox", { name: /Molly/u })).toBeChecked();

  page.once("dialog", async (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Close moment composer" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveClass(/composer-scroll-locked/u);
});

test("required content rejects whitespace and future dates before review", async ({
  page,
}) => {
  await page.goto("/family");
  const cases = [
    { choice: /Written entry/u, field: "Entry", error: "Write a thought" },
    { choice: /Location/u, field: "Place name", error: "Name the place" },
  ] as const;

  for (const testCase of cases) {
    const dialog = await openComposer(page);
    await dialog.getByRole("button", { name: testCase.choice }).click();
    if (testCase.choice.source.includes("Location")) {
      await dialog.getByRole("button", { name: /^Place,/u }).click();
    }
    const field = dialog.getByLabel(testCase.field);
    await field.fill(" \n ");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText(testCase.error);
    await expect(field).toBeFocused();
    await expect(
      dialog.getByRole("heading", { name: "Review entry" }),
    ).toHaveCount(0);
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog.getByRole("button", { name: "Close moment composer" }).click();
  }

  const dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /Written entry/u }).click();
  await dialog.getByRole("textbox", { name: "Entry" }).fill("Later");
  await dialog.getByRole("button", { name: /^Moment date,/u }).click();
  await expect(
    dialog
      .getByRole("dialog", { name: "Choose moment date" })
      .getByRole("button", { name: "Aug 29, 2026", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: /^Moment date,/u }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Review entry" }),
  ).toHaveCount(0);
});

test("Escape and backdrop dismissal restore focus without a draft", async ({
  page,
}) => {
  await page.goto("/family");
  const trigger = page.getByRole("button", { name: "Add moment" });

  await openComposer(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();

  const dialog = await openComposer(page);
  await dialog.click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("all four capture modes save directly without a confirmation screen", async ({
  page,
}) => {
  await page.goto("/family");

  let dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /^Photo/u }).click();
  const photoInput = page.getByLabel(/Choose photo/u);
  await photoInput.setInputFiles({
    name: "invalid.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not really an image"),
  });
  await expect(page.locator(".composer-error")).toContainText(
    "could not be shown",
  );
  await photoInput.setInputFiles("public/sample-family.jpg");
  const photoPreview = page.getByAltText("Selected photo preview");
  await expect(photoPreview).toBeVisible();
  await expect(photoPreview).toHaveJSProperty("complete", true);
  expect(
    await photoPreview.evaluate(
      (image: HTMLImageElement) => image.naturalWidth,
    ),
  ).toBeGreaterThan(0);
  await expect(
    page.getByText("Photo ready for this local preview."),
  ).toBeVisible();
  await expect(photoPreview).not.toHaveAttribute("style");
  await page.getByRole("textbox", { name: "Note" }).fill("The last warm hour.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Review entry" })).toHaveCount(
    0,
  );

  dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /Written entry/u }).click();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("The kitchen was loud.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /Bible verse/u }).click();
  await selectBiblePassage(dialog, { book: "John", chapter: 3, start: 16 });
  await expect(dialog.getByLabel("Verse text")).toHaveValue(/only born Son/u);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /Location/u }).click();
  await expect(dialog.getByRole("textbox", { name: "Details" })).toBeVisible();
  await setComposerPlace(dialog, "Sand Harbor");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
});

test("design-mode save emits no mutation, persistence, history, or timeline change", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Browser storage inventory runs once.");
  await page.goto("/family", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const timelineImages = Array.from(
      document.querySelectorAll<HTMLImageElement>("[data-moment-kind] img"),
    );
    for (const image of timelineImages) image.loading = "eager";
    await Promise.all(
      timelineImages.map(async (image) => {
        if (image.complete && image.naturalWidth > 0) return;
        await image.decode();
      }),
    );
  });
  await page.evaluate(() => {
    const auditWindow = window as typeof window & {
      __composerCacheMutations?: string[];
      __composerIdbOperations?: string[];
    };
    auditWindow.__composerCacheMutations = [];
    auditWindow.__composerIdbOperations = [];
    const originalCachePut = Cache.prototype.put;
    const originalCacheAdd = Cache.prototype.add;
    const originalCacheAddAll = Cache.prototype.addAll;
    const originalCacheDelete = Cache.prototype.delete;
    Cache.prototype.put = function (request, response) {
      auditWindow.__composerCacheMutations?.push("put");
      return originalCachePut.call(this, request, response);
    };
    Cache.prototype.add = function (request) {
      auditWindow.__composerCacheMutations?.push("add");
      return originalCacheAdd.call(this, request);
    };
    Cache.prototype.addAll = function (requests) {
      auditWindow.__composerCacheMutations?.push("addAll");
      return originalCacheAddAll.call(this, requests);
    };
    Cache.prototype.delete = function (request, options) {
      auditWindow.__composerCacheMutations?.push("delete");
      return originalCacheDelete.call(this, request, options);
    };
    const originalOpen = indexedDB.open.bind(indexedDB);
    const originalDelete = indexedDB.deleteDatabase.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        auditWindow.__composerIdbOperations?.push(`open:${name}`);
        return version === undefined
          ? originalOpen(name)
          : originalOpen(name, version);
      },
    });
    Object.defineProperty(indexedDB, "deleteDatabase", {
      configurable: true,
      value: (name: string) => {
        auditWindow.__composerIdbOperations?.push(`delete:${name}`);
        return originalDelete(name);
      },
    });
  });
  const browserInventory = () =>
    page.evaluate(async () => {
      const cacheInventory: Array<{
        name: string;
        requests: Array<{ method: string; url: string }>;
      }> = [];
      if ("caches" in window) {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          cacheInventory.push({
            name,
            requests: (await cache.keys()).map((request) => ({
              method: request.method,
              url: request.url,
            })),
          });
        }
      }
      return {
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
        cookies: document.cookie,
        databases:
          "databases" in indexedDB
            ? (await indexedDB.databases()).map(
                (database) => database.name ?? "",
              )
            : [],
        caches: cacheInventory,
        historyLength: history.length,
        historyState: JSON.stringify(history.state),
        url: location.href,
        title: document.title,
      };
    });
  const baseline = await browserInventory();
  const timeline = page.locator("[data-moment-kind]");
  const timelineBaseline = await timeline.evaluateAll((moments) =>
    moments.map((moment) => ({
      kind: moment.getAttribute("data-moment-kind"),
      text: moment.textContent,
    })),
  );
  const interactionRequests: Array<{
    method: string;
    resourceType: string;
    url: string;
  }> = [];
  page.on("request", (request) => {
    interactionRequests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });

  const malicious =
    '<img src=x onerror="window.__composerInjected=true"><script>bad()</script>';
  const privateFilenameMarker = "PRIVATE-FAMILY-FILENAME-7821.jpg";
  const dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /^Photo/u }).click();
  await dialog.getByLabel(/Choose photo/u).setInputFiles({
    name: privateFilenameMarker,
    mimeType: "image/jpeg",
    buffer: readFileSync("public/sample-family.jpg"),
  });
  const privatePhoto = dialog.getByAltText("Selected photo preview");
  await expect(privatePhoto).toBeVisible();
  await expect(
    dialog.getByText("Photo ready for this local preview."),
  ).toBeVisible();
  await dialog.getByRole("textbox", { name: "Note" }).fill(malicious);
  await expect(dialog.getByRole("textbox", { name: "Note" })).toHaveValue(
    malicious,
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __composerInjected?: boolean })
          .__composerInjected,
    ),
  ).toBeUndefined();
  await expect(page.locator("body")).not.toContainText(privateFilenameMarker);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  expect(
    await timeline.evaluateAll((moments) =>
      moments.map((moment) => ({
        kind: moment.getAttribute("data-moment-kind"),
        text: moment.textContent,
      })),
    ),
  ).toEqual(timelineBaseline);
  const after = await browserInventory();
  expect(after).toEqual(baseline);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __composerIdbOperations?: string[] })
          .__composerIdbOperations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __composerCacheMutations?: string[] })
          .__composerCacheMutations,
    ),
  ).toEqual([]);
  expect(
    interactionRequests.filter((request) => /^https?:/u.test(request.url)),
  ).toEqual([]);
  expect(JSON.stringify(interactionRequests)).not.toContain(
    privateFilenameMarker,
  );

  let draftDialog = await openComposer(page);
  await draftDialog
    .getByRole("button", {
      name: "Written entry Text, date, and details",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("Never persist this draft");
  await page.reload();
  await expect(page.getByRole("dialog")).toBeHidden();
  draftDialog = await openComposer(page);
  await draftDialog
    .getByRole("button", {
      name: "Written entry Text, date, and details",
      exact: true,
    })
    .click();
  await expect(page.getByRole("textbox", { name: "Entry" })).toHaveValue("");

  await page.getByRole("button", { name: "Close moment composer" }).click();
  draftDialog = await openComposer(page);
  await draftDialog.getByRole("button", { name: /^Photo/u }).click();
  await draftDialog.getByLabel(/Choose photo/u).setInputFiles({
    name: privateFilenameMarker,
    mimeType: "image/jpeg",
    buffer: readFileSync("public/sample-family.jpg"),
  });
  await expect(
    draftDialog.getByText("Photo ready for this local preview."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeHidden();
  draftDialog = await openComposer(page);
  await draftDialog.getByRole("button", { name: /^Photo/u }).click();
  await expect(draftDialog.getByAltText("Selected photo preview")).toHaveCount(
    0,
  );
  await expect(page.locator("body")).not.toContainText(privateFilenameMarker);
});

test("expanded capture states have no serious axe violations", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Axe coverage runs once in Chromium.");
  await page.goto("/family");
  const scan = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  };

  const dialog = await openComposer(page);
  await scan();
  await dialog.getByRole("button", { name: /Bible verse/u }).click();
  await selectBiblePassage(dialog, { book: "John", chapter: 3, start: 16 });
  await expect(dialog.getByLabel("Verse text")).toHaveValue(/only born Son/u);
  await page.getByRole("button", { name: /Details/u }).click();
  await scan();
  await scan();
});

test("an open entry overlay does not scroll the family feed underneath", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/family");
  await page.evaluate(() => window.scrollTo(0, 160));
  const backgroundScroll = await page.evaluate(() => window.scrollY);
  expect(backgroundScroll).toBeGreaterThan(0);
  const feedTop = async () =>
    page
      .locator("[data-moment-kind]")
      .first()
      .evaluate((element) => Math.round(element.getBoundingClientRect().top));
  const originTop = await feedTop();

  const dialog = await openComposer(page);
  await dialog.getByRole("button", { name: /Bible verse/u }).click();
  await selectBiblePassage(dialog, {
    book: "Proverbs",
    chapter: 28,
    start: 10,
    end: 21,
  });
  await expect(dialog.getByLabel("Verse text")).toHaveValue(/upright/u);
  await expect(page.locator("html")).toHaveClass(/composer-scroll-locked/u);
  await expect(page.locator("body")).toHaveClass(/composer-scroll-locked/u);
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
  expect(await feedTop()).toBe(originTop);

  await page.getByRole("button", { name: /^Chapter,/u }).hover();
  const prevented = await page.evaluate(() => {
    const event = new WheelEvent("wheel", {
      deltaY: 480,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
  expect(await feedTop()).toBe(originTop);

  const verse = page.getByLabel("Verse text");
  await verse.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) return;
    element.scrollTop = 48;
  });
  expect(
    await verse.evaluate((element) =>
      element instanceof HTMLTextAreaElement ? element.scrollTop : 0,
    ),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
  expect(await feedTop()).toBe(originTop);

  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Close moment composer" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
});

test("keyboard-sized viewport keeps every capture and review control reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  const backgroundScroll = await page.evaluate(() => window.scrollY);
  const dialog = await openComposer(page);
  await dialog
    .getByRole("button", {
      name: "Written entry Text, date, and details",
      exact: true,
    })
    .click();
  const text = page.getByRole("textbox", { name: "Entry" });
  await text.fill("Short screen");
  await page.getByRole("button", { name: /Details/u }).click();

  await page.setViewportSize({ width: 320, height: 350 });
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
  const mollyTag = dialog
    .locator(".people-tags label")
    .filter({ hasText: "Molly" });
  for (const control of [
    page.getByRole("button", { name: "Close moment composer" }),
    text,
    page.getByRole("button", { name: /^Moment date,/u }),
    dialog.getByRole("button", { name: /^Journal,/u }),
    page.getByRole("button", { name: /Details/u }),
    mollyTag,
    page.getByRole("button", { name: /^Place,/u }),
    page.getByRole("button", { name: "Save" }),
  ]) {
    await expectReachable(control);
  }
  await expectMinimumTargets(dialog);
  await expectReadableInputType(dialog);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
});
