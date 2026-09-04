import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";

function firstPhoto(page: Page) {
  return page.locator('[data-moment-kind="photo"]').first();
}

async function openNoteForm(page: Page, card: Locator = firstPhoto(page)) {
  const trigger = card.getByRole("button", { name: /Add a note to/u });
  await trigger.click();
  const form = card.locator(".inline-note-form");
  await expect(form).toBeVisible();
  return { form, trigger };
}

test("family activity is visible inline and reactions open as a picker", async ({
  page,
}) => {
  await page.goto("/family");
  await expect(
    page.getByText("The quiet ride home was my favorite part.", {
      exact: true,
    }),
  ).toBeVisible();

  const card = firstPhoto(page);
  const trigger = card.getByRole("button", {
    name: /Choose a reaction for photo/u,
  });
  await expect(trigger).toHaveText("♡");
  await trigger.click();

  const picker = card.getByRole("menu", { name: "Choose a reaction" });
  await expect(picker).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(picker).toHaveCSS("position", "absolute");
  const pickerBox = await picker.boundingBox();
  const triggerBox = await trigger.boundingBox();
  expect(pickerBox).toBeTruthy();
  expect(triggerBox).toBeTruthy();
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(
    triggerBox!.y + 2,
  );
  expect(pickerBox!.height).toBeLessThan(120);
  const motion = await picker.evaluate((element) => {
    const style = getComputedStyle(element);
    const originY = Number.parseFloat(
      style.transformOrigin.split(" ")[1] ?? "",
    );
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      originY,
      height: element.getBoundingClientRect().height,
    };
  });
  expect(motion.animationName).toContain("overlay-popover-in");
  expect(Number.parseFloat(motion.animationDuration)).toBeCloseTo(0.18, 2);
  expect(motion.originY).toBeGreaterThan(motion.height);
  await expect(picker.getByRole("menuitemradio")).toHaveCount(3);
  await picker.getByRole("menuitemradio", { name: "Laugh" }).click();
  await expect(picker).toBeHidden();
  await expect(trigger).toHaveText("😂");

  await trigger.click();
  await picker.getByRole("menuitemradio", { name: "Heart" }).click();
  await expect(trigger).toHaveText("❤️");
});

test("reduced motion opens the heart picker without scale or fade", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/family");
  const card = firstPhoto(page);
  const trigger = card.getByRole("button", {
    name: /Choose a reaction for photo/u,
  });
  await trigger.click();
  const picker = card.getByRole("menu", { name: "Choose a reaction" });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveCSS("position", "absolute");
  await expect(picker).toHaveCSS("animation-name", "none");
  await picker.getByRole("menuitemradio", { name: "Laugh" }).click();
  await expect(picker).toBeHidden();
});

test("inline note drafts save safely and remain reversible", async ({
  page,
}) => {
  await page.goto("/family");
  const card = firstPhoto(page);
  const { form, trigger } = await openNoteForm(page, card);
  const note = form.getByRole("textbox", { name: "Add a family note" });
  await expect(note).toBeFocused();
  await expect(form.getByRole("button", { name: "Save" })).toBeDisabled();

  const hostileNote =
    '<img data-detail-injection src=x onerror="window.__detailInjected=true"> A safe family note';
  await note.fill(hostileNote);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(trigger).toBeFocused();
  await card.getByRole("button", { name: /Show 1 more/u }).click();
  await expect(card.getByText(hostileNote, { exact: true })).toBeVisible();
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
  await card
    .getByRole("button", { name: /Choose a reaction for photo/u })
    .click();
  await card.getByRole("menuitemradio", { name: "Meaningful" }).click();
  const { form } = await openNoteForm(page, card);
  await form
    .getByRole("textbox", { name: "Add a family note" })
    .fill("A local-only preview note");
  await form.getByRole("button", { name: "Save" }).click();

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
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  };

  await card
    .getByRole("button", { name: /Choose a reaction for photo/u })
    .click();
  await scan();
  await card.getByRole("menuitemradio", { name: "Heart" }).click();
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
    const trigger = card.getByRole("button", { name: /Choose a reaction/u });
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      url: location.href,
      historyLength: history.length,
      historyState: JSON.stringify(history.state),
    }));
    await trigger.click();
    await expect(
      card.getByRole("menu", { name: "Choose a reaction" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        url: location.href,
        historyLength: history.length,
        historyState: JSON.stringify(history.state),
      })),
    ).toEqual(before);
  }
});
