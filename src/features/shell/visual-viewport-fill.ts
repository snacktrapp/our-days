export type VisualViewportBox = Readonly<{
  top: number;
  left: number;
  width: number;
  height: number;
}>;

export function readVisualViewportBox(
  view: Pick<Window, "visualViewport"> = window,
): VisualViewportBox | null {
  const viewport = view.visualViewport;
  if (!viewport) return null;
  return {
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
    width: viewport.width,
    height: viewport.height,
  };
}

export function applyVisualViewportFill(
  element: HTMLElement | null,
  view: Pick<Window, "visualViewport"> = window,
) {
  if (!element) return;
  const box = readVisualViewportBox(view);
  if (!box) {
    element.style.removeProperty("top");
    element.style.removeProperty("left");
    element.style.removeProperty("width");
    element.style.removeProperty("height");
    return;
  }
  element.style.position = "fixed";
  element.style.margin = "0";
  element.style.top = `${box.top}px`;
  element.style.left = `${box.left}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  element.style.bottom = "auto";
}

export function subscribeVisualViewportFill(
  element: HTMLElement | null,
  view: Pick<Window, "visualViewport"> & {
    addEventListener: Window["addEventListener"];
    removeEventListener: Window["removeEventListener"];
  } = window,
) {
  const sync = () => applyVisualViewportFill(element, view);
  sync();
  const viewport = view.visualViewport;
  viewport?.addEventListener("resize", sync);
  viewport?.addEventListener("scroll", sync);
  view.addEventListener("resize", sync);
  view.addEventListener("orientationchange", sync);
  return () => {
    viewport?.removeEventListener("resize", sync);
    viewport?.removeEventListener("scroll", sync);
    view.removeEventListener("resize", sync);
    view.removeEventListener("orientationchange", sync);
    if (!element) return;
    element.style.removeProperty("position");
    element.style.removeProperty("margin");
    element.style.removeProperty("top");
    element.style.removeProperty("left");
    element.style.removeProperty("width");
    element.style.removeProperty("height");
    element.style.removeProperty("bottom");
  };
}
