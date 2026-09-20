import { expect, test } from "./test";

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
  await page.evaluate(() => scrollTo(0, 495));
  await expect(header).toHaveAttribute("data-scroll-hidden", "true");
  await page.evaluate(() => scrollTo(0, 470));
  await expect(header).toHaveAttribute("data-scroll-hidden", "false");
  await expect(header).toHaveCSS("translate", "none");
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
});
