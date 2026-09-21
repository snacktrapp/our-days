import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  localAlexPersonId,
  localJordanPersonId,
  localCircleId,
} from "../../src/lib/local-journal/ids";

test("fresh thread comments appear as a banner and in Activity without replaying history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let fresh = false;
  let requests = 0;
  await page.route("**/api/activity", async (route) => {
    requests += 1;
    await route.fulfill({
      json: {
        observedAt: fresh ? "2026-09-20T10:01:30Z" : "2026-09-20T10:01:00Z",
        items: [
          {
            id: fresh ? "note:fresh" : "note:old",
            actorName: "Molly",
            message: "also commented on Brian’s post.",
            displayDate: "Today",
            createdAt: fresh ? "2026-09-20T10:01:05Z" : "2026-09-19T10:00:00Z",
            href: "/family#moment-thread",
          },
        ],
      },
    });
  });
  await page.clock.install();
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("button", { name: /Open notifications/ }),
  ).toBeVisible();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByRole("status", { name: "New comment" })).toHaveCount(
    0,
  );
  fresh = true;
  await page.clock.fastForward(31000);
  const banner = page.getByRole("status", { name: "New comment" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link")).toHaveAttribute(
    "href",
    "/family#moment-thread",
  );
  const box = await banner.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: "test-results/comment-banner.png" });
  await banner.getByRole("button", { name: "Dismiss notification" }).click();
  await page.getByRole("button", { name: /Open notifications/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Activity" })
      .getByText("Molly also commented on Brian’s post."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

async function jpegFixture(index = 0) {
  const directory = mkdtempSync(join(tmpdir(), "our-days-photo-"));
  const path = join(directory, `porch-${index}.jpg`);
  writeFileSync(
    path,
    await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 196, g: 122, b: 88 + index },
      },
    })
      .jpeg()
      .toBuffer(),
  );
  return path;
}

test("Activity refreshes on each open and recovers from a failed refresh", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("button", { name: /Open notifications/ }),
  ).toBeVisible();
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/activity", { cache: "no-store" });
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: await response.json(),
    };
  });
  expect(api.status).toBe(200);
  expect(api.cache).toBe("private, no-store");
  expect(Array.isArray(api.body.items)).toBe(true);

  let fail = false;
  let actor = "Jordan";
  let requests = 0;
  await page.route("**/api/activity", async (route) => {
    requests += 1;
    await route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        fail
          ? { error: "unavailable" }
          : {
              items: [
                {
                  id: `new-${requests}`,
                  actorName: actor,
                  message: "posted a photo.",
                  displayDate: "Today",
                  href: "/family#moment-test",
                },
              ],
            },
      ),
    });
  });
  const trigger = page.getByRole("button", { name: /Open notifications/ });
  const dialog = page.getByRole("dialog", { name: "Activity" });
  await trigger.click();
  await expect(dialog.getByText("Jordan posted a photo.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  actor = "New family activity";
  await trigger.click();
  await expect(
    dialog.getByText("New family activity posted a photo."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  fail = true;
  await trigger.click();
  await expect(
    dialog.getByText("Activity couldn’t be refreshed."),
  ).toBeVisible();
  await expect(dialog.getByText("No new family activity.")).toHaveCount(0);
  fail = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByText("Activity couldn’t be refreshed.")).toHaveCount(
    0,
  );
  expect(requests).toBe(4);
  await page.screenshot({ path: "test-results/activity-refresh.png" });
});

test("Circles browsing retains the personal Journal and posts as the signed-in author", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("button", { name: "Choose a journal" }).click();
  await page.getByRole("link", { name: "Just me", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${localAlexPersonId}$`));
  await page.getByRole("link", { name: "Circles", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Circles", exact: true }),
  ).toBeVisible();
  await page
    .locator(
      `a[href="/people/${localJordanPersonId}?fromCircle=${localCircleId}"]`,
    )
    .click();
  await expect(
    page.getByRole("heading", { name: "Jordan", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Written entry Text/ }).click();
  await expect(page.getByRole("checkbox", { name: "Just me" })).toBeChecked();
  await page
    .getByRole("textbox", { name: "Entry", exact: true })
    .fill("My own entry while browsing Jordan.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/people/${localAlexPersonId}`));
  await expect(
    page
      .getByLabel("Chronological moments for Alex")
      .getByText("My own entry while browsing Jordan."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Circles", exact: true }).click();
  await page.locator(`a[href="/family?circle=${localCircleId}"]`).click();
  await expect(
    page.getByRole("button", { name: "Choose a journal" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "← Back to Circles" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Just me", exact: true }),
  ).toBeVisible();
});

test("header touch selection survives a focusless blur and opens the signed-in journal", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const trigger = page.getByRole("button", { name: "Choose a journal" });
  await trigger.tap();
  await trigger.focus();
  const justMe = page.getByRole("link", { name: "Just me", exact: true });
  // Exercise Safari's blur-before-click ordering even on Chromium CI.
  await justMe.evaluate((node) => {
    node.addEventListener(
      "pointerdown",
      () => {
        (document.activeElement as HTMLElement)?.blur();
      },
      { once: true },
    );
  });
  await justMe.tap();
  await expect(page).toHaveURL(new RegExp(`/people/${localAlexPersonId}$`));
  await expect(page.getByLabel("Chronological moments for Alex")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Just me", exact: true }),
  ).toBeVisible();
  await trigger.tap();
  await page.getByRole("link", { name: "All circles", exact: true }).tap();
  await expect(page).toHaveURL(/\/family$/);
  await expect(page.getByLabel("Chronological family moments")).toBeVisible();
});

test("navigation keeps the same controls and chosen title through a delayed feed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByLabel("Chronological family moments")).toBeVisible();
  await page.evaluate(() => {
    const nav = document.querySelector(".bottom-nav");
    const header = document.querySelector(".topbar");
    const evidence = { titles: [] as string[], lostControls: false };
    Object.assign(window, { transitionEvidence: evidence });
    const observer = new MutationObserver(() => {
      evidence.titles.push(
        `${document.querySelector(".topbar .our-days-wordmark")?.getAttribute("aria-label")}|${document.querySelector(".topbar h1")?.textContent}`,
      );
      if (
        document.querySelector(".bottom-nav") !== nav ||
        document.querySelector(".topbar") !== header
      )
        evidence.lostControls = true;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/people/${localAlexPersonId}*`, async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Choose a journal" }).tap();
  await page.getByRole("link", { name: "Just me", exact: true }).tap();
  await expect(
    page.getByRole("heading", { name: "Just me", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".bottom-nav svg")).toHaveCount(3);
  await expect(page.getByLabel("Opening this journal")).toBeVisible();
  release();
  await expect(page.getByLabel("Chronological moments for Alex")).toBeVisible();
  const evidence = await page.evaluate(
    () =>
      (
        window as unknown as {
          transitionEvidence: { titles: string[]; lostControls: boolean };
        }
      ).transitionEvidence,
  );
  expect(evidence.lostControls).toBe(false);
  const selected = evidence.titles.indexOf("Our Days|Just me");
  expect(selected).toBeGreaterThanOrEqual(0);
  expect(
    evidence.titles
      .slice(selected)
      .every((title) => title === "Our Days|Just me"),
  ).toBe(true);
  for (const destination of [
    { href: "/circles", link: "Circles", pair: "Our Days|Circles" },
    { href: "/settings/family", link: "Settings", pair: "Our Days|Account" },
    {
      href: `/people/${localAlexPersonId}`,
      link: "Journal",
      pair: "Our Days|Just me",
    },
  ]) {
    await page.evaluate(() => {
      (
        window as unknown as { transitionEvidence: { titles: string[] } }
      ).transitionEvidence.titles = [];
    });
    let resume!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    await page.route(`**${destination.href}*`, async (route) => {
      const response = await route.fetch();
      await responseGate;
      await route.fulfill({ response });
    });
    try {
      await page
        .getByRole("link", { name: destination.link, exact: true })
        .click();
      await expect(page.locator(".topbar h1")).toHaveText(
        destination.pair.split("|")[1],
      );
      await expect(page.locator(".topbar .our-days-wordmark")).toHaveAttribute(
        "aria-label",
        destination.pair.split("|")[0],
      );
    } finally {
      resume();
    }
    await expect(page.locator(".journal-route-content")).not.toHaveAttribute(
      "hidden",
    );
    const pairs = await page.evaluate(
      () =>
        (window as unknown as { transitionEvidence: { titles: string[] } })
          .transitionEvidence.titles,
    );
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.every((pair) => pair === destination.pair)).toBe(true);
    await page.unroute(`**${destination.href}*`);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/our-days-persistent-shell.png" });
});

test("cold open paints usable Family content after sign-in", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page).toHaveURL(/\/family$/u);
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Chronological family moments")).toBeVisible();
  await expect(page.getByLabel("Opening this journal")).toHaveCount(0);
  // The first nav in the streamed HTML is the loading shell, before client
  // hydration or feed data. Its icons must not be empty placeholder spans.
  const html = await (await page.request.get("/family")).text();
  const firstNav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0];
  expect(firstNav).toBeDefined();
  expect(firstNav!.match(/<svg\b/g)).toHaveLength(3);
  await expect(page.getByText("Something interrupted the story")).toHaveCount(
    0,
  );
  expect(pageErrors).toEqual([]);
});

test("nearby album requests all photos before the cover finishes and retains them across swipes", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Photo or video Media with date and note" })
    .click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      await Promise.all(Array.from({ length: 6 }, (_, i) => jpegFixture(i))),
    );
  await expect(
    page.getByText("6 photos ready to upload privately."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Note" })
    .fill("Six carousel loading fixtures.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const card = page
    .locator(".moment-card")
    .filter({ hasText: "Six carousel loading fixtures." });
  await expect(card.locator(".photo-card-pager-dots span")).toHaveCount(6, {
    timeout: 30_000,
  });

  // Hold every response: all album requests must start without waiting for
  // the cover (or any earlier slide) to finish downloading.
  const momentId = await card.evaluate((node) =>
    node.closest("article")!.id.replace(/^moment-/, ""),
  );
  const albumPath = `/api/media/moments/${momentId}`;
  let releasePhotos!: () => void;
  const heldPhotos = new Promise<void>((resolve) => {
    releasePhotos = resolve;
  });
  await page.route(`**${albumPath}?*`, async (route) => {
    await heldPhotos;
    await route.continue();
  });
  // Reload the persisted album so the assertions measure delivery, not upload.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/media/moments/") &&
      request.url().includes("photo=")
    )
      requests.push(request.url());
  });
  await page.reload();
  await card.scrollIntoViewIfNeeded();
  const pager = card.locator(".photo-card-pager");
  const albumRequests = () =>
    requests.filter((url) => new URL(url).pathname === albumPath);
  try {
    await expect.poll(() => albumRequests().length).toBe(6);
    await expect(pager.locator("img")).toHaveCount(0);
  } finally {
    releasePhotos();
  }
  await expect(pager.locator("img")).toHaveCount(6);
  const firstSrc = await pager
    .locator('[data-photo-index="0"] img')
    .getAttribute("src");
  await expect.poll(() => albumRequests().length).toBe(6);
  const swipe = async (direction: "next" | "prev") => {
    await pager.evaluate((node, direction) => {
      const box = node.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + 30;
      const end = x + (direction === "next" ? -90 : 90);
      for (const [type, clientX] of [
        ["pointerdown", x],
        ["pointermove", end],
        ["pointerup", end],
      ] as const) {
        node.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            clientX,
            clientY: y,
          }),
        );
      }
    }, direction);
    await expect(pager.locator(".photo-card-pager-track")).toHaveAttribute(
      "data-phase",
      "idle",
    );
  };
  await swipe("next");
  await expect(pager.getByText("Photo 2 of 6")).toHaveCount(1);
  await expect.poll(() => albumRequests().length).toBe(6);
  await swipe("prev");
  await expect(pager.getByText("Photo 1 of 6")).toHaveCount(1);
  expect(albumRequests()).toHaveLength(6);
  await expect(pager.locator('[data-photo-index="0"] img')).toHaveAttribute(
    "src",
    firstSrc!,
  );
  await page.getByRole("link", { name: "Circles", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Circles", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await card.scrollIntoViewIfNeeded();
  await expect(pager.locator("img")).toHaveCount(6);
  expect(albumRequests()).toHaveLength(6);
  await page.screenshot({ path: "test-results/carousel-neighbor-loading.png" });
  expect(errors).toEqual([]);
});

test("sign in, write a moment, attach media, and browse by date", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Open your family journal." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toHaveAttribute("href", "/api/auth/oauth/google");
  await expect(
    page.getByRole("link", { name: "Sign in with X" }),
  ).toHaveAttribute("href", "/api/auth/oauth/x");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Written entry Text, date, and details" })
    .click();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("Casey left a pebble on the porch.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("Casey left a pebble on the porch."),
  ).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Photo or video Media with date and note" })
    .click();
  await page.locator('input[type="file"]').setInputFiles(await jpegFixture());
  await expect(
    page.getByText("Photo ready to upload privately."),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Note" }).fill("The last warm hour.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("The last warm hour."),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-moment-kind="photo"]').first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Photo or video Media with date and note" })
    .click();
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/synthetic-short.mp4");
  await expect(
    page.getByText("Wait for this video to finish loading."),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Note" }).fill("A one-second wave.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("A one-second wave."),
  ).toBeVisible({
    timeout: 20_000,
  });
  const videoCard = page.locator('[data-moment-kind="video"]').first();
  await expect(videoCard).toBeVisible();
  await expect(videoCard.getByText("Video", { exact: true })).toBeVisible();
  const timelineVideo = videoCard.locator("video");
  await expect(timelineVideo).toHaveCount(1);
  await expect(timelineVideo).toHaveAttribute("controls");
  await expect(timelineVideo).toHaveAttribute("playsinline");
  await expect(
    videoCard.getByRole("button", { name: /full screen/u }),
  ).toHaveCount(0);
  await timelineVideo.evaluate((video) => (video as HTMLVideoElement).play());
  await expect
    .poll(
      async () =>
        timelineVideo.evaluate((video) => !(video as HTMLVideoElement).paused),
      {
        timeout: 8_000,
      },
    )
    .toBe(true);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();

  await page.goto("/memories");
  await expect(page.getByText("On this day", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "This date across years" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Browse memories from \d{4}/u })
    .first()
    .click();
  await expect(
    page.getByText("Casey left a pebble on the porch."),
  ).toBeVisible();

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  await expect(manifest.json()).resolves.toMatchObject({
    name: "Our Days",
    display: "standalone",
    start_url: "/",
  });
});

test("Just Me stays owner-only across All Circles and personal journals", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Written entry Text, date, and details" })
    .click();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("A porch thought just for me.");
  await page.getByRole("checkbox", { name: "Just me" }).click();
  await expect(page.getByRole("button", { name: /Alex · You/u })).toHaveCount(
    0,
  );
  await expect(page.getByText("Who else was part of this?")).toBeVisible();
  await page.getByRole("button", { name: "Post", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/people/${localAlexPersonId}`));
  await expect(
    page
      .getByLabel("Chronological moments for Alex")
      .getByText("A porch thought just for me."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page
      .locator(".moment-card")
      .filter({ hasText: "A porch thought just for me." })
      .locator(".just-me-pill"),
  ).toHaveText("Just me");

  await page.goto("/family");
  await expect(page.getByLabel("Chronological family moments")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page
      .getByLabel("Chronological family moments")
      .getByText("A porch thought just for me."),
  ).toBeVisible();

  await page.goto(`/people/${localJordanPersonId}`);
  await expect(page.getByLabel("Chronological moments for Jordan")).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.getByText("A porch thought just for me.")).toHaveCount(0);
});

test("unconfigured Google and X stay on the invitation gate", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toBeVisible();
  await page.goto("/api/auth/oauth/google");
  await expect(page).toHaveURL(/\/sign-in\?oauth=unavailable/u);
  await expect(
    page.getByText("That sign-in method is unavailable right now."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeVisible();
});
