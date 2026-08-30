import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";

const syntheticClip = readFileSync("tests/fixtures/synthetic-short.mp4");

async function expectFocusToStayInDialog(
  page: Page,
  dialog: Locator,
  key: "Tab" | "Shift+Tab",
) {
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press(key);
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
      `${key} focus must remain in the video dialog`,
    ).toBe(true);
  }
}

test("video remains an isolated, honest, accessible feasibility preview", async ({
  page,
}) => {
  const response = await page.goto("/quality/video-feasibility");
  expect(response?.headers()["cache-control"]).toContain("private");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(
    page.getByRole("heading", { name: "Could video feel this quiet?" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Short video feasibility timeline"),
  ).toBeVisible();
  await expect(page.locator(".time-rail")).toBeVisible();
  await expect(page.getByText("A possibility, not a promise")).toBeVisible();
  await expect(page.getByText("Decision still pending")).toBeVisible();

  const trigger = page.getByRole("button", { name: "Try a short video" });
  await expect(trigger).toContainText("Try a short video");
  const routeResults = await new AxeBuilder({ page }).analyze();
  expect(
    routeResults.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  const picker = page.getByLabel("Choose a short video");
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute(
    "aria-describedby",
    "video-feasibility-picker-constraints",
  );
  await expect(
    page.getByText("Local feasibility preview · Nothing is uploaded or saved"),
  ).toBeVisible();
  await expect(dialog.locator("video")).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const privateFilename = "PRIVATE-SYNTHETIC-FAMILY-CLIP-7319.mp4";
  await picker.setInputFiles({
    name: privateFilename,
    mimeType: "video/mp4",
    buffer: syntheticClip,
  });
  const video = page.getByLabel("Selected video preview");
  await expect(video).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Clip ready to preview");
  expect(
    await video.evaluate(
      (element: HTMLVideoElement) =>
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        element.duration > 0 &&
        element.videoWidth > 0 &&
        element.videoHeight > 0,
    ),
  ).toBe(true);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expect(page.locator("body")).not.toContainText(privateFilename);

  await page.getByRole("button", { name: "Remove video" }).focus();
  await expectFocusToStayInDialog(page, dialog, "Tab");
  await page.getByRole("button", { name: "Remove video" }).focus();
  await expectFocusToStayInDialog(page, dialog, "Shift+Tab");
  await page.getByRole("button", { name: "Remove video" }).click();
  await expect(picker).toBeFocused();
  await expect(video).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("dialog").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "Add moment" }).click();
  await expect(page.getByRole("button", { name: /Short video/u })).toHaveCount(
    0,
  );
});

test("video preview remains reachable on a short phone and honors reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 350 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quality/video-feasibility");
  await page.getByRole("button", { name: "Try a short video" }).click();

  const dialog = page.getByRole("dialog");
  const sheet = page.locator(".video-feasibility-dialog .composer-sheet");
  await expect(dialog).toBeVisible();
  await expect(sheet).toHaveCSS("animation-name", "none");

  const chooser = page.locator(".video-feasibility-input");
  const close = page.getByRole("button", { name: "Close local preview" });
  await page.getByLabel("Choose a short video").setInputFiles({
    name: "synthetic-short.mp4",
    mimeType: "video/mp4",
    buffer: syntheticClip,
  });
  await expect(page.getByLabel("Selected video preview")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await chooser.scrollIntoViewIfNeeded();
  await expect(chooser).toBeInViewport();
  await close.scrollIntoViewIfNeeded();
  await expect(close).toBeInViewport();

  const geometry = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.clientHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(
    await chooser.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
});

test("video selection fails locally without network, persistence, filename, or cache mutation", async ({
  browserName,
  page,
}, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "chromium-mobile",
    "Browser mutation inventory runs once.",
  );
  await page.goto("/quality/video-feasibility", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await page.evaluate(() => {
    const auditWindow = window as typeof window & {
      __videoCacheMutations?: string[];
      __videoIdbOperations?: string[];
    };
    auditWindow.__videoCacheMutations = [];
    auditWindow.__videoIdbOperations = [];
    const originalPut = Cache.prototype.put;
    const originalAdd = Cache.prototype.add;
    const originalAddAll = Cache.prototype.addAll;
    const originalDelete = Cache.prototype.delete;
    Cache.prototype.put = function (request, response) {
      auditWindow.__videoCacheMutations?.push("put");
      return originalPut.call(this, request, response);
    };
    Cache.prototype.add = function (request) {
      auditWindow.__videoCacheMutations?.push("add");
      return originalAdd.call(this, request);
    };
    Cache.prototype.addAll = function (requests) {
      auditWindow.__videoCacheMutations?.push("addAll");
      return originalAddAll.call(this, requests);
    };
    Cache.prototype.delete = function (request, options) {
      auditWindow.__videoCacheMutations?.push("delete");
      return originalDelete.call(this, request, options);
    };
    const originalOpen = indexedDB.open.bind(indexedDB);
    const originalDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        auditWindow.__videoIdbOperations?.push(`open:${name}`);
        return version === undefined
          ? originalOpen(name)
          : originalOpen(name, version);
      },
    });
    Object.defineProperty(indexedDB, "deleteDatabase", {
      configurable: true,
      value: (name: string) => {
        auditWindow.__videoIdbOperations?.push(`delete:${name}`);
        return originalDeleteDatabase(name);
      },
    });
  });

  const browserInventory = () =>
    page.evaluate(async () => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      cookies: document.cookie,
      databases:
        "databases" in indexedDB
          ? (await indexedDB.databases()).map((database) => database.name ?? "")
          : [],
      cacheNames: await caches.keys(),
      historyLength: history.length,
      historyState: JSON.stringify(history.state),
      url: location.href,
    }));

  const baseline = await browserInventory();
  const interactionRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    interactionRequests.push({ method: request.method(), url: request.url() });
  });

  await page.getByRole("button", { name: "Try a short video" }).click();
  const successfulPrivateFilename = "PRIVATE-READY-CLIP-8421.mp4";
  await page.getByLabel("Choose a short video").setInputFiles({
    name: successfulPrivateFilename,
    mimeType: "video/mp4",
    buffer: syntheticClip,
  });
  const readyVideo = page.getByLabel("Selected video preview");
  await expect(page.getByRole("status")).toContainText("Clip ready to preview");
  await readyVideo.evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(() =>
      readyVideo.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await readyVideo.evaluate((element: HTMLVideoElement) => element.pause());
  await expect(page.locator("body")).not.toContainText(
    successfulPrivateFilename,
  );
  await page.getByRole("button", { name: "Remove video" }).click();
  await expect(page.getByLabel("Choose a short video")).toBeFocused();

  const privateFilename = "PRIVATE-FAMILY-CLIP-9842.mov";
  await page.getByLabel("Choose a short video").setInputFiles({
    name: privateFilename,
    mimeType: "video/quicktime",
    buffer: Buffer.from("not a decodable family video"),
  });
  await expect(page.locator(".composer-error[role='alert']")).toContainText(
    "This video could not be played",
  );
  await expect(page.locator("body")).not.toContainText(privateFilename);
  await expect(page.getByLabel("Selected video preview")).toHaveCount(0);
  await expect(page.getByLabel("Choose a short video")).toBeFocused();

  expect(await browserInventory()).toEqual(baseline);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __videoIdbOperations?: string[] })
          .__videoIdbOperations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __videoCacheMutations?: string[] })
          .__videoCacheMutations,
    ),
  ).toEqual([]);
  expect(
    interactionRequests.filter((request) => /^https?:/u.test(request.url)),
  ).toEqual([]);
  expect(JSON.stringify(interactionRequests)).not.toContain(privateFilename);
  expect(JSON.stringify(interactionRequests)).not.toContain(
    successfulPrivateFilename,
  );

  await page.reload();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("body")).not.toContainText(privateFilename);
  await expect(page.locator("body")).not.toContainText(
    successfulPrivateFilename,
  );
});
