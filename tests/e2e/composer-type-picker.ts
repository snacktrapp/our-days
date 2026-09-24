import { expect, type Locator } from "@playwright/test";

export async function expectTypePickerHugsContent(sheet: Locator) {
  const geometry = await sheet.evaluate((element) => {
    const choices = element.querySelector(".moment-choices");
    if (!(choices instanceof HTMLElement)) {
      throw new Error("Type picker sheet is missing moment choices.");
    }
    const cards = Array.from(choices.querySelectorAll("button"));
    if (cards.length < 4) {
      throw new Error("Type picker expected four entry cards.");
    }
    const sheetRect = element.getBoundingClientRect();
    const lastRowBottom = Math.max(
      cards[2].getBoundingClientRect().bottom,
      cards[3].getBoundingClientRect().bottom,
    );
    const sheetBody = element.querySelector(".composer-sheet-body");
    const bodyStyle =
      sheetBody instanceof HTMLElement ? getComputedStyle(sheetBody) : null;
    const bodyPaddingBottom = bodyStyle
      ? Number.parseFloat(bodyStyle.paddingBottom)
      : 0;
    const safeAreaInset =
      Number.parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--safe-area-inset-bottom")
          .replace("px", ""),
      ) || 0;
    const gapBelowLastRow = sheetRect.bottom - lastRowBottom;
    const slackBelowPadding = gapBelowLastRow - bodyPaddingBottom;
    return {
      sheetHeight: sheetRect.height,
      sheetBottom: sheetRect.bottom,
      lastRowBottom,
      gapBelowLastRow,
      bodyPaddingBottom,
      slackBelowPadding,
      safeAreaInset,
      viewport: window.innerHeight,
      fitsWithoutScroll:
        sheetBody instanceof HTMLElement
          ? sheetBody.scrollHeight <= sheetBody.clientHeight + 1
          : false,
    };
  });

  expect(geometry.gapBelowLastRow).toBeLessThanOrEqual(
    32 + geometry.safeAreaInset + 8,
  );
  expect(geometry.slackBelowPadding).toBeLessThanOrEqual(8);
  expect(geometry.fitsWithoutScroll).toBe(true);
  expect(
    Math.abs(geometry.viewport - geometry.sheetBottom),
  ).toBeLessThanOrEqual(40);

  return geometry;
}
