"use client";

import { forwardRef, type ReactNode } from "react";
import { dispatchMomentHeart, usePairedTap } from "./double-tap-heart";

export const DoubleTapHeartText = forwardRef<
  HTMLQuoteElement,
  Readonly<{
    momentId: string;
    className?: string;
    children: ReactNode;
    expandable?: boolean;
    expanded?: boolean;
    onSingleTap?: () => void;
  }>
>(function DoubleTapHeartText(
  { momentId, className, children, expandable, expanded, onSingleTap },
  ref,
) {
  const onTap = usePairedTap({
    onDoubleTap: () => dispatchMomentHeart(momentId),
    onSingleTap,
  });

  return (
    <blockquote
      ref={ref}
      className={className}
      aria-expanded={expandable ? expanded : undefined}
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("a, button")) {
          return;
        }
        onTap(event.detail);
      }}
    >
      {children}
    </blockquote>
  );
});
