import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useScrollAwayHeader } from "./use-scroll-away-header";

let pathname = "/family";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
function Bars() {
  const ref = useScrollAwayHeader();
  return (
    <>
      <header ref={ref} data-testid="header" />
      <nav className="bottom-nav" tabIndex={0} />
    </>
  );
}
afterEach(() => {
  pathname = "/family";
  vi.restoreAllMocks();
});
function scroll(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  act(() => window.dispatchEvent(new Event("scroll")));
}
function setup() {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 4000,
  });
  scroll(0);
  return render(<Bars />);
}
it("mirrors each scroll pixel, reverses immediately, and resets at the top", () => {
  const { unmount } = setup();
  scroll(12);
  expect(
    screen
      .getByTestId("header")
      .style.getPropertyValue("--header-scroll-offset"),
  ).toBe("-12px");
  expect(
    document.documentElement.style.getPropertyValue(
      "--journal-nav-scroll-offset",
    ),
  ).toBe("12px");
  scroll(8);
  expect(
    document.documentElement.style.getPropertyValue(
      "--journal-nav-scroll-offset",
    ),
  ).toBe("8px");
  scroll(0);
  expect(
    document.documentElement.style.getPropertyValue(
      "--journal-nav-scroll-offset",
    ),
  ).toBe("0px");
  unmount();
  expect(
    document.documentElement.style.getPropertyValue(
      "--journal-nav-scroll-offset",
    ),
  ).toBe("");
});
it.each(["/circles", "/settings", "/settings/family"])(
  "keeps bottom navigation stable on %s",
  (path) => {
    pathname = path;
    setup();
    scroll(100);
    expect(
      document.documentElement.style.getPropertyValue(
        "--journal-nav-scroll-offset",
      ),
    ).toBe("0px");
  },
);
it("resets bottom navigation when leaving the journal", () => {
  const { rerender } = setup();
  scroll(100);
  pathname = "/circles";
  rerender(<Bars />);
  expect(
    document.documentElement.style.getPropertyValue(
      "--journal-nav-scroll-offset",
    ),
  ).toBe("0px");
});
