import { expect, test } from "./test";

for (const theme of ["dark", "light"]) {
  test(`${theme} journal grid stays fixed behind opaque posts`, async ({
    page,
  }) => {
    await page.goto("/family");
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const shell = page.locator(".app-shell");
    const grid = () =>
      shell.evaluate((element) => {
        const style = getComputedStyle(element, "::before");
        return {
          position: style.position,
          top: style.top,
          image: style.backgroundImage,
          size: style.backgroundSize,
          pointerEvents: style.pointerEvents,
        };
      });
    const before = await grid();
    expect(before.position).toBe("fixed");
    expect(before.image).toContain("linear-gradient");
    expect(before.size).toContain("28px 28px");
    expect(before.pointerEvents).toBe("none");
    const card = page.locator(".moment-card").first();
    await expect(page.locator(".moment").first()).toHaveCSS(
      "margin-bottom",
      "30px",
    );
    const y = (await card.boundingBox())!.y;
    const fill = await card.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(fill).toMatch(/^rgb\(/);
    await page.evaluate(() => scrollTo(0, 225));
    await expect
      .poll(async () => (await card.boundingBox())!.y)
      .toBeLessThan(y);
    expect(await grid()).toEqual(before);
    await card.evaluate((element) => {
      scrollTo(0, element.getBoundingClientRect().bottom + scrollY - 200);
    });
    await page.screenshot({ path: `/tmp/our-days-grid-${theme}.png` });
    // Fullscreen media and other overlays must retain their plain canvas.
    await page.evaluate(() =>
      document.documentElement.classList.add("overlay-open"),
    );
    expect((await grid()).image).toBe("none");
  });
}
