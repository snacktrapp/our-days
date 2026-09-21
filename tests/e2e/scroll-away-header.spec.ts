import { expect, test } from "./test";

test("header tracks partial scrolls without continuing after scrolling stops", async ({
  page,
}) => {
  await page.goto("/family");
  const header = page.locator(".topbar");
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  const top = (await header.boundingBox())!.y;
  await page.evaluate(() => scrollTo(0, 20));
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(top - 20, 1);
  // Wait beyond the old 180ms animation to prove there is no delayed snap.
  await page.waitForTimeout(250);
  expect((await header.boundingBox())!.y).toBeCloseTo(top - 20, 1);
  await page.evaluate(() => scrollTo(0, 10));
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(top - 10, 1);
  await page.evaluate(() => scrollTo(0, 0));
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(top, 1);
});

test("header hides down, returns up, and never moves the bottom navigation", async ({
  page,
}) => {
  await page.goto("/family");
  const header = page.locator(".topbar");
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  const bottom = await page.locator(".bottom-nav").boundingBox();
  const post = page.locator("[data-moment-kind]").first();
  const documentTop = await post.evaluate(
    (element) => element.getBoundingClientRect().top + scrollY,
  );
  await page.evaluate(() => scrollTo(0, 500));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
  await expect
    .poll(
      async () =>
        (await header.boundingBox())!.y + (await header.boundingBox())!.height,
    )
    .toBeLessThan(0);
  // Preserve the bottom nav's existing compact-on-scroll behavior, but keep
  // its bottom edge anchored rather than following the disappearing header.
  const compactBottom = await page.locator(".bottom-nav").boundingBox();
  expect(compactBottom!.y + compactBottom!.height).toBeCloseTo(
    bottom!.y + bottom!.height,
    1,
  );
  expect(
    await post.evaluate(
      (element) => element.getBoundingClientRect().top + scrollY,
    ),
  ).toBe(documentTop);
  await page.screenshot({ path: "/tmp/our-days-header-hidden.png" });
  const hiddenY = (await header.boundingBox())!.y;
  await page.evaluate(() => scrollTo(0, 495));
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(hiddenY + 5, 1);
  await page.evaluate(() => scrollTo(0, 470));
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeCloseTo(hiddenY + 30, 1);
  await page.evaluate(() => scrollTo(0, 350));
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await expect(header).toHaveCSS("translate", "0px");
  await page.screenshot({ path: "/tmp/our-days-header-returned.png" });
  await page.getByRole("button", { name: "Choose a journal" }).click();
  await page.evaluate(() => scrollTo(0, 700));
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await page.keyboard.press("Escape");
  await page.evaluate(() => scrollTo(0, 0));
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
});

test("reduced motion and keyboard focus can reveal the header", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/family");
  const header = page.locator(".topbar");
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await page.evaluate(() => scrollTo(0, 500));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
  await expect(header).toHaveCSS("transition-duration", "0s");
  await header.locator("a").first().focus();
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  // Focus must reveal, not permanently pin, the header after restoration.
  await page.evaluate(() => scrollTo(0, 750));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
});

test("header resumes scrolling after background and page-cache restoration", async ({
  page,
}) => {
  await page.goto("/family");
  const header = page.locator(".topbar");
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await page.evaluate(() => scrollTo(0, 500));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await page.evaluate(() => scrollTo(0, 650));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await page.evaluate(() => scrollTo(0, 800));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
});
