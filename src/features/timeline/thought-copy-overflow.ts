export const thoughtCopyPreviewLines = 5;

export function thoughtCopyOverflows(
  element: HTMLElement,
  lines = thoughtCopyPreviewLines,
): boolean {
  const styles = getComputedStyle(element);
  const parsedLineHeight = Number.parseFloat(styles.lineHeight);
  const parsedFontSize = Number.parseFloat(styles.fontSize);
  const lineHeight =
    Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
      ? parsedLineHeight
      : Number.isFinite(parsedFontSize) && parsedFontSize > 0
        ? parsedFontSize * 1.5
        : 0;
  if (lineHeight === 0) {
    return element.scrollHeight > element.clientHeight + 1;
  }
  return element.scrollHeight > lineHeight * lines + 1;
}
