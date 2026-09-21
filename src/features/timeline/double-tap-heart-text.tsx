"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { dispatchMomentHeart, usePairedTap } from "./double-tap-heart";
import { HeartGlyph } from "./heart-glyph";

export const DoubleTapHeartText = forwardRef<
  HTMLQuoteElement,
  Readonly<{
    momentId: string;
    className?: string;
    children: ReactNode;
    onSingleTap?: () => void;
  }>
>(function DoubleTapHeartText(
  { momentId, className, children, onSingleTap },
  ref,
) {
  const [burst, setBurst] = useState(0);
  const onTap = usePairedTap({
    onDoubleTap: () => {
      if (dispatchMomentHeart(momentId)) setBurst((current) => current + 1);
    },
    onSingleTap,
  });

  return (
    <blockquote
      ref={ref}
      className={["double-tap-note", className].filter(Boolean).join(" ")}
      onClick={(event) => {
        if ((event.target as Element).closest("a, button, input, textarea"))
          return;
        onTap(event.detail);
      }}
    >
      {children}
      {burst > 0 ? (
        <span
          key={burst}
          className="post-love-burst"
          onAnimationEnd={() => setBurst(0)}
        >
          <HeartGlyph filled />
        </span>
      ) : null}
    </blockquote>
  );
});
