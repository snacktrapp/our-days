/** Previous or next text field in the written sheet. Ends stay put. */
export function adjacentComposerField(
  ids: readonly string[],
  current: string | null,
  direction: -1 | 1,
) {
  if (!current) return null;
  const index = ids.indexOf(current);
  if (index < 0) return null;
  const next = index + direction;
  if (next < 0 || next >= ids.length) return null;
  return ids[next] ?? null;
}

/**
 * Written-sheet height once `keyboardInset` points of keyboard cover the
 * bottom of the screen. The closed sheet is min(88% of the window, the
 * window minus the top gap), matching the web editor.
 */
export function composerSheetHeight(
  input: Readonly<{
    windowHeight: number;
    topGap: number;
    keyboardInset: number;
    choosing: boolean;
  }>,
) {
  if (input.choosing) return Math.max(input.windowHeight * 0.5, 300);
  const aboveKeyboard = input.windowHeight - input.topGap - Math.max(0, input.keyboardInset);
  return Math.min(input.windowHeight * 0.88, Math.max(240, aboveKeyboard));
}
