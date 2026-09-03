import { describe, expect, it } from "vitest";
import { thoughtCopyOverflows } from "./thought-copy-overflow";

function copy(scrollHeight: number, fontSize = 18, lineHeight = 27) {
  const element = document.createElement("blockquote");
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { value: lineHeight * 5 });
  element.style.fontSize = `${fontSize}px`;
  element.style.lineHeight = `${lineHeight}px`;
  return element;
}

describe("thoughtCopyOverflows", () => {
  it("keeps a short note unclamped", () => {
    expect(thoughtCopyOverflows(copy(80))).toBe(false);
  });

  it("treats a 26-line verse as overflowing five lines", () => {
    expect(thoughtCopyOverflows(copy(27 * 26))).toBe(true);
  });
});
