import AxeBuilder from "@axe-core/playwright";
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

async function expectReachable(control: Locator) {
  await control.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" }),
  );
  await expect(control).toBeInViewport({ ratio: 1 });
}

async function expectMinimumTargets(dialog: Locator) {
  const undersized = await dialog
    .locator("button, textarea")
    .evaluateAll((targets) =>
      targets
        .filter((target) => target.getClientRects().length > 0)
        .map((target) => {
          const rect = target.getBoundingClientRect();
          return {
            label: target.getAttribute("aria-label") || target.textContent,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(({ width, height }) => width < 43.9 || height < 43.9),
    );
  expect(undersized).toEqual([]);
}

async function collectFocusCycle(
  page: Page,
  dialog: Locator,
  key: "Tab" | "Shift+Tab",
) {
  const controlCount = await dialog.locator(focusableSelector).count();
  const visited = new Set<number>();
  for (let index = 0; index < controlCount + 1; index += 1) {
    const state = await dialog.evaluate((element, selector) => {
      const active = document.activeElement;
      const controls = [...element.querySelectorAll(selector)];
      return {
        contained: Boolean(active && element.contains(active)),
        index: controls.findIndex((control) => control === active),
      };
    }, focusableSelector);
    expect(
      state.contained,
      `${key} focus must remain in the detail sheet`,
    ).toBe(true);
    if (state.index >= 0) visited.add(state.index);
    await page.keyboard.press(key);
  }
  return visited;
}

async function expectCompleteFocusTraversal(page: Page, dialog: Locator) {
  const first = dialog.getByRole("button", { name: "Close moment details" });
  await first.focus();
  const forward = await collectFocusCycle(page, dialog, "Tab");
  await first.focus();
  const reverse = await collectFocusCycle(page, dialog, "Shift+Tab");
  const visited = [...new Set([...forward, ...reverse])].sort(
    (left, right) => left - right,
  );
  expect(visited).toEqual(
    Array.from(
      { length: await dialog.locator(focusableSelector).count() },
      (_, index) => index,
    ),
  );
}

function moment(page: Page, kind: string) {
  return page.locator(`[data-moment-kind="${kind}"]`).first();
}

async function openNotes(page: Page, kind = "photo") {
  const card = moment(page, kind);
  const trigger = card.getByRole("button", { name: /Open private notes/u });
  await trigger.click();
  return { card, dialog: page.getByRole("dialog"), trigger };
}

async function browserInventory(page: Page) {
  return page.evaluate(async () => {
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
          ? (await indexedDB.databases()).map((database) => database.name ?? "")
          : [],
      caches: cacheInventory,
      historyLength: history.length,
      historyState: JSON.stringify(history.state),
      url: location.href,
      title: document.title,
    };
  });
}

test("moment details are modal, identity-safe, count-free, and restore the exact opener", async ({
  page,
}) => {
  await page.goto("/family");
  await expect(page.getByRole("button", { name: /\d+ notes/iu })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("The quiet ride home was my favorite part."),
  ).toHaveCount(0);

  const noteCanaries = [
    "The quiet ride home was my favorite part.",
    "I can still hear everyone laughing by the water.",
    "I wrote this down because I knew I would miss the noise.",
    "Those wet shoes stayed by the door for days.",
    "That brave wave still gets me.",
  ] as const;
  const cases = [
    {
      kind: "photo",
      kicker: "An ordinary Friday",
      personName: "Brian",
      displayDate: "Aug 28, 2026",
      accessibleName: "Photo: An ordinary Friday — Brian, Aug 28, 2026",
      notes: noteCanaries.slice(0, 2),
      familyResponse: "MollyHold close",
    },
    {
      kind: "thought",
      kicker: "A thought",
      personName: "Molly",
      displayDate: "Aug 14, 2026",
      accessibleName:
        "Thought: “Tonight the kitchen was loud, the floor was a mess, and I wished I cou… — Molly, Aug 14, 2026",
      notes: [noteCanaries[2]],
      familyResponse: null,
    },
    {
      kind: "location",
      kicker: "A place we’ll remember",
      personName: "Molly",
      displayDate: "Jul 6, 2026",
      accessibleName: "Place: Sand Harbor · Lake Tahoe — Molly, Jul 6, 2026",
      notes: [noteCanaries[3]],
      familyResponse: null,
    },
    {
      kind: "milestone",
      kicker: "Milestone",
      personName: "Avery",
      displayDate: "Aug 21, 2023",
      accessibleName: "Milestone: First day of school — Avery, Aug 21, 2023",
      notes: [noteCanaries[4]],
      familyResponse: "MollyMade me smile",
    },
  ] as const;

  for (const {
    kind,
    kicker,
    personName,
    displayDate,
    accessibleName,
    notes,
    familyResponse,
  } of cases) {
    const { card, dialog, trigger } = await openNotes(page, kind);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
      true,
    );
    await expect(
      dialog.getByRole("heading", { name: "Notes from family" }),
    ).toBeFocused();
    await expect(dialog).toHaveAccessibleName(accessibleName);
    await expect(dialog).toHaveAccessibleDescription(
      "Local design preview · Notes and reactions are not saved",
    );
    const anchor = dialog.locator(
      `.moment-detail-anchor[data-moment-kind="${kind}"]`,
    );
    await expect(anchor).toBeVisible();
    await expect(anchor).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator(".moment-detail-summary")).toContainText(
      kicker,
    );
    await expect(dialog.locator(".moment-detail-summary")).toContainText(
      personName,
    );
    await expect(dialog.locator(".moment-detail-summary")).toContainText(
      displayDate,
    );
    for (const canary of noteCanaries) {
      await expect(dialog.getByText(canary, { exact: true })).toHaveCount(
        (notes as readonly string[]).includes(canary) ? 1 : 0,
      );
    }
    const familyReactions = dialog.locator(".family-reactions");
    if (familyResponse) {
      await expect(familyReactions).toContainText(familyResponse);
    } else {
      await expect(familyReactions).toHaveCount(0);
      await expect(
        dialog.getByText("No family responses are attached to this moment."),
      ).toBeVisible();
    }
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expectMinimumTargets(dialog);
    const close = dialog.getByRole("button", { name: "Close moment details" });
    await expect(close).toBeVisible();
    await expect(close).toBeInViewport({ ratio: 1 });
    expect((await close.boundingBox())?.y).toBeLessThan(90);

    let backgroundBlocked = false;
    try {
      await page
        .getByRole("button", { name: "Add moment" })
        .click({ trial: true, timeout: 500 });
    } catch {
      backgroundBlocked = true;
    }
    expect(backgroundBlocked).toBe(true);

    await dialog.getByRole("button", { name: "Close moment details" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(card).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  }

  for (const kind of ["photo", "thought"] as const) {
    const card = page.locator(`[data-moment-kind="${kind}"]`).last();
    const trigger = card.getByRole("button", { name: /Open private notes/u });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".family-notes")).toHaveCount(0);
    await expect(dialog.locator(".family-reactions")).toHaveCount(0);
    await expect(
      dialog.getByText("No notes here yet. The moment can stay quiet."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close moment details" }).click();
    await expect(trigger).toBeFocused();
  }

  const respond = moment(page, "photo").getByRole("button", {
    name: /Respond to/u,
  });
  await respond.click();
  const responseDialog = page.getByRole("dialog");
  await expect(
    responseDialog.getByRole("heading", { name: "A quiet response" }),
  ).toBeFocused();
  await expectCompleteFocusTraversal(page, responseDialog);
  await responseDialog
    .getByRole("button", { name: "Close moment details" })
    .click();
  await expect(respond).toBeFocused();
});

test("local responses and note previews are reversible, validated, and protected", async ({
  page,
}) => {
  await page.goto("/family");
  const respond = moment(page, "photo").getByRole("button", {
    name: /Respond to/u,
  });
  await respond.click();
  const dialog = page.getByRole("dialog");
  const hold = dialog.getByRole("button", { name: "Hold close", exact: true });
  const smile = dialog.getByRole("button", {
    name: "Made me smile",
    exact: true,
  });
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await smile.click();
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  await expect(smile).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("status")).toContainText("Nothing was saved");

  const note = dialog.getByRole("textbox", {
    name: "Your note to the family",
  });
  await note.fill("   ");
  await dialog.getByRole("button", { name: "Preview note" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Write a note before previewing it.",
  );
  await expect(note).toBeFocused();

  const hostileNote =
    '<img data-detail-injection src=x onerror="window.__detailInjected=true"> DETAIL-PRIVATE-8421';
  await note.fill(hostileNote);
  await dialog.getByRole("button", { name: "Preview note" }).click();
  const preview = dialog.getByRole("article", {
    name: "Your local note preview",
  });
  await expect(preview).toContainText(hostileNote);
  await expect(preview.locator("[data-detail-injection]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __detailInjected?: boolean })
          .__detailInjected,
    ),
  ).toBeUndefined();

  page.once("dialog", (confirmation) => confirmation.dismiss());
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(preview).toBeVisible();
  await expect(smile).toHaveAttribute("aria-pressed", "true");

  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(dialog).toBeHidden();
  await expect(respond).toBeFocused();

  await respond.click();
  await expect(
    dialog.getByRole("textbox", { name: "Your note to the family" }),
  ).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Made me smile", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");

  await note.fill("Escape should protect this.");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  await expect(note).toHaveValue("Escape should protect this.");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
});

test("detail interaction has no network, persistence, history, or timeline side effect", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "Browser inventory runs once.",
  );
  await page.goto("/family", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await page.evaluate(() => {
    const auditWindow = window as typeof window & {
      __detailCacheMutations?: string[];
      __detailIdbOperations?: string[];
      __detailStorageMutations?: string[];
    };
    auditWindow.__detailCacheMutations = [];
    auditWindow.__detailIdbOperations = [];
    auditWindow.__detailStorageMutations = [];
    const originalStorageSetItem = Storage.prototype.setItem;
    const originalStorageRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    Storage.prototype.setItem = function (key, value) {
      auditWindow.__detailStorageMutations?.push(`set:${key}`);
      return originalStorageSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      auditWindow.__detailStorageMutations?.push(`remove:${key}`);
      return originalStorageRemoveItem.call(this, key);
    };
    Storage.prototype.clear = function () {
      auditWindow.__detailStorageMutations?.push("clear");
      return originalStorageClear.call(this);
    };
    const originalCachePut = Cache.prototype.put;
    const originalCacheAdd = Cache.prototype.add;
    const originalCacheAddAll = Cache.prototype.addAll;
    const originalCacheDelete = Cache.prototype.delete;
    Cache.prototype.put = function (request, response) {
      auditWindow.__detailCacheMutations?.push("put");
      return originalCachePut.call(this, request, response);
    };
    Cache.prototype.add = function (request) {
      auditWindow.__detailCacheMutations?.push("add");
      return originalCacheAdd.call(this, request);
    };
    Cache.prototype.addAll = function (requests) {
      auditWindow.__detailCacheMutations?.push("addAll");
      return originalCacheAddAll.call(this, requests);
    };
    Cache.prototype.delete = function (request, options) {
      auditWindow.__detailCacheMutations?.push("delete");
      return originalCacheDelete.call(this, request, options);
    };
    const originalOpen = indexedDB.open.bind(indexedDB);
    const originalDelete = indexedDB.deleteDatabase.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        auditWindow.__detailIdbOperations?.push(`open:${name}`);
        return version === undefined
          ? originalOpen(name)
          : originalOpen(name, version);
      },
    });
    Object.defineProperty(indexedDB, "deleteDatabase", {
      configurable: true,
      value: (name: string) => {
        auditWindow.__detailIdbOperations?.push(`delete:${name}`);
        return originalDelete(name);
      },
    });
  });

  const baseline = await browserInventory(page);
  const timeline = page.locator(".timeline");
  const timelineBaseline = await timeline.evaluate(
    (element) => element.outerHTML,
  );
  const interactionRequests: Array<{
    method: string;
    resourceType: string;
    url: string;
  }> = [];
  const interactionWebSockets: string[] = [];
  page.on("request", (request) =>
    interactionRequests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    }),
  );
  page.on("websocket", (socket) => interactionWebSockets.push(socket.url()));

  const { dialog } = await openNotes(page);
  await dialog.getByRole("button", { name: "I remember", exact: true }).click();
  const privateMarker = "DETAIL-PRIVATE-8421";
  const hostileNote = `<script>window.__detailInjected=true</script>${privateMarker}`;
  await dialog
    .getByRole("textbox", { name: "Your note to the family" })
    .fill(hostileNote);
  await dialog.getByRole("button", { name: "Preview note" }).click();
  await expect(dialog.getByText(hostileNote)).toBeVisible();
  await expect(dialog.locator("script")).toHaveCount(0);
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Close preview" }).click();

  expect(await timeline.evaluate((element) => element.outerHTML)).toBe(
    timelineBaseline,
  );
  expect(await browserInventory(page)).toEqual(baseline);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __detailIdbOperations?: string[] })
          .__detailIdbOperations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __detailStorageMutations?: string[] })
          .__detailStorageMutations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __detailCacheMutations?: string[] })
          .__detailCacheMutations,
    ),
  ).toEqual([]);
  expect(interactionWebSockets).toEqual([]);
  expect(
    interactionRequests.filter((request) => /^https?:/u.test(request.url)),
  ).toEqual([]);
  expect(JSON.stringify(interactionRequests)).not.toContain(privateMarker);

  await openNotes(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hold close", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Your note to the family" })
    .fill("Never persist this detail draft");
  await page.reload();
  await expect(page.getByRole("dialog")).toBeHidden();
  const reopened = await openNotes(page);
  await expect(
    reopened.dialog.getByRole("textbox", { name: "Your note to the family" }),
  ).toHaveValue("");
  await expect(
    reopened.dialog.getByRole("button", { name: "Hold close", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("detail states have no serious accessibility findings", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "Axe coverage runs once in Chromium.",
  );
  await page.goto("/family");
  const scan = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  };

  let { dialog } = await openNotes(page, "photo");
  await scan();
  await dialog.getByRole("button", { name: "Hold close", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Your note to the family" })
    .fill("A valid note preview for the accessibility scan.");
  await dialog.getByRole("button", { name: "Preview note" }).click();
  await scan();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Close preview" }).click();

  ({ dialog } = await openNotes(page, "thought"));
  await scan();
});

test("keyboard-sized detail keeps all controls reachable without moving the timeline", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-short",
    "The exact short-screen contract runs in its pinned project.",
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/family");
  const deepMoment = page.locator('[data-moment-kind="thought"]').last();
  const trigger = deepMoment.getByRole("button", {
    name: /Open private notes/u,
  });
  await trigger.scrollIntoViewIfNeeded();
  const backgroundScroll = await page.evaluate(() => window.scrollY);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await page.setViewportSize({ width: 320, height: 350 });

  for (const control of [
    dialog.getByRole("button", { name: "Close moment details" }),
    dialog.getByRole("button", { name: "Hold close", exact: true }),
    dialog.getByRole("button", { name: "Made me smile", exact: true }),
    dialog.getByRole("button", { name: "I remember", exact: true }),
    dialog.getByRole("textbox", { name: "Your note to the family" }),
    dialog.getByRole("button", { name: "Preview note" }),
    dialog.getByRole("button", { name: "Close preview" }),
  ]) {
    await expectReachable(control);
  }
  await expectMinimumTargets(dialog);
  const fontSize = await dialog
    .getByRole("textbox", { name: "Your note to the family" })
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  expect(fontSize).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);

  await dialog.getByRole("button", { name: "Hold close", exact: true }).click();
  await expectReachable(dialog.getByRole("button", { name: "Clear response" }));
  const shortNote = dialog.getByRole("textbox", {
    name: "Your note to the family",
  });
  await shortNote.fill(
    "A long local note for the smallest supported viewport. ".repeat(8),
  );
  await dialog.getByRole("button", { name: "Preview note" }).click();
  await expectReachable(dialog.getByRole("button", { name: "Back to edit" }));
  await expectReachable(dialog.getByRole("button", { name: "Clear preview" }));
  await dialog.getByRole("button", { name: "Back to edit" }).click();
  await expect(shortNote).toBeFocused();
  await expect(shortNote).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Preview note" }).click();
  await dialog.getByRole("button", { name: "Clear preview" }).click();
  await dialog.getByRole("button", { name: "Clear response" }).click();
  await expect(
    dialog.getByRole("button", { name: "Close moment details" }),
  ).toBeInViewport({ ratio: 1 });

  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
});

test("the detail sheet opens without entrance motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/family");
  const { dialog } = await openNotes(page);
  await expect(dialog.locator(".moment-detail-sheet")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("personal and memory timelines open the same identity-safe detail without navigation drift", async ({
  page,
}) => {
  for (const path of ["/people/molly", "/memories/on-this-day"] as const) {
    await page.goto(path);
    const card = page.locator("[data-moment-kind]").first();
    const trigger = card.getByRole("button", { name: /Open private notes/u });
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      url: location.href,
      historyLength: history.length,
      historyState: JSON.stringify(history.state),
      scrollY: window.scrollY,
    }));

    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".moment-detail-anchor")).toBeInViewport({
      ratio: 1,
    });
    await dialog.getByRole("button", { name: "Close moment details" }).click();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(() => ({
        url: location.href,
        historyLength: history.length,
        historyState: JSON.stringify(history.state),
        scrollY: window.scrollY,
      })),
    ).toEqual(before);
  }
});
