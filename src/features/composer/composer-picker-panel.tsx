"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";

export const composerEditorScrollClass = "composer-editor-scroll";
const pickerScrollPadding = 12;

export function scrollComposerPickerIntoView(panel: Element) {
  const scroller = panel.closest(`.${composerEditorScrollClass}`);
  if (!(scroller instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
    return;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const overflowBottom =
    panelRect.bottom - (scrollerRect.bottom - pickerScrollPadding);
  if (overflowBottom > 1) {
    scroller.scrollTop += overflowBottom;
    return;
  }

  const overflowTop = scrollerRect.top + pickerScrollPadding - panelRect.top;
  if (overflowTop > 1) {
    scroller.scrollTop -= overflowTop;
  }
}

export function ComposerPickerPanel({
  className,
  ...props
}: ComponentProps<"section">) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    scrollComposerPickerIntoView(panel);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      scrollComposerPickerIntoView(panel);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return <section ref={ref} className={className} {...props} />;
}
