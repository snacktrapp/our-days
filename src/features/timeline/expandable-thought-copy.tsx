"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DoubleTapHeartText } from "./double-tap-heart-text";
import { thoughtCopyOverflows } from "./thought-copy-overflow";

export function ExpandableThoughtCopy({
  momentId,
  className,
  children,
}: Readonly<{
  momentId: string;
  className?: string;
  children: ReactNode;
}>) {
  const copyRef = useRef<HTMLQuoteElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = copyRef.current;
    if (!element) return;

    const measure = () => {
      const clampedNow = element.classList.contains("thought-copy-clamped");
      if (clampedNow) element.classList.remove("thought-copy-clamped");
      setOverflows(thoughtCopyOverflows(element));
      if (clampedNow) element.classList.add("thought-copy-clamped");
    };

    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);

  const clamp = overflows && !expanded;

  return (
    <>
      <DoubleTapHeartText
        ref={copyRef}
        momentId={momentId}
        className={[className, clamp ? "thought-copy-clamped" : null]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </DoubleTapHeartText>
      {overflows ? (
        <button
          className="thought-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}
    </>
  );
}
