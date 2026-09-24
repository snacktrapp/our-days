import { expect, type Locator } from "@playwright/test";

/** Assert the Add type-picker sheet is ~half-viewport tall with cards near mid-screen. */
export async function expectTypePickerMidScreen(sheet: Locator) {
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
    const firstRowTop = Math.min(
      cards[0].getBoundingClientRect().top,
      cards[1].getBoundingClientRect().top,
    );
    const lastRowBottom = Math.max(
      cards[2].getBoundingClientRect().bottom,
      cards[3].getBoundingClientRect().bottom,
    );
    const cardsMidY = (firstRowTop + lastRowBottom) / 2;
    const sheetBody = element.querySelector(".composer-sheet-body");
    const safeAreaInset =
      Number.parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--safe-area-inset-bottom")
          .replace("px", ""),
      ) || 0;
    return {
      sheetHeight: sheetRect.height,
      sheetTop: sheetRect.top,
      sheetBottom: sheetRect.bottom,
      firstRowTop,
      lastRowBottom,
      cardsMidY,
      safeAreaInset,
      viewport: window.innerHeight,
      fitsWithoutScroll:
        sheetBody instanceof HTMLElement
          ? sheetBody.scrollHeight <= sheetBody.clientHeight + 1
          : false,
    };
  });

  const expectedMinHeight = Math.max(geometry.viewport * 0.5, 300);
  // Sheet should be about half the viewport (with a short-screen floor).
  expect(geometry.sheetHeight).toBeGreaterThanOrEqual(expectedMinHeight - 24);
  expect(geometry.sheetHeight).toBeLessThanOrEqual(expectedMinHeight + 48);
  // Anchored to the bottom of the phone.
  expect(
    Math.abs(geometry.viewport - geometry.sheetBottom),
  ).toBeLessThanOrEqual(40);
  // Sheet top near vertical midpoint.
  expect(geometry.sheetTop).toBeGreaterThanOrEqual(geometry.viewport * 0.4);
  expect(geometry.sheetTop).toBeLessThanOrEqual(geometry.viewport * 0.6);
  // Cards live in the upper ~70% of the sheet (under the handle), which puts
  // them around mid-screen on phones. SE-class (667) card mid can reach ~0.8.
  expect(geometry.cardsMidY).toBeGreaterThanOrEqual(geometry.sheetTop);
  expect(geometry.cardsMidY).toBeLessThanOrEqual(
    geometry.sheetTop + geometry.sheetHeight * 0.7,
  );
  expect(geometry.firstRowTop).toBeLessThan(geometry.viewport * 0.72);
  expect(geometry.fitsWithoutScroll).toBe(true);
  expect(geometry.lastRowBottom).toBeLessThanOrEqual(
    geometry.sheetBottom - geometry.safeAreaInset + 1,
  );

  return geometry;
}

/** @deprecated Use expectTypePickerMidScreen — kept as an alias for call-site churn. */
export const expectTypePickerHugsContent = expectTypePickerMidScreen;
