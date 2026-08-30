import { expect, test } from "./test";

const routes = ["/family", "/people/molly", "/people", "/memories"];

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
  await page.goto("/family");

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  await expect(
    page.getByRole("heading", { name: "All our days" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Add moment" }).click();
  const dialog = page.getByRole("dialog");
  const photoChoice = page.getByRole("button", { name: /Photo or video/ });
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
