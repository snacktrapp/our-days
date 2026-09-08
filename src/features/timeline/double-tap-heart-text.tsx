"use client";

import { forwardRef, type ReactNode } from "react";
import { dispatchMomentHeart, usePairedTap } from "./double-tap-heart";

export const DoubleTapHeartText = forwardRef<
  HTMLQuoteElement,
  Readonly<{
    momentId: string;
    className?: string;
    children: ReactNode;
    onSingleTap?: () => void;
    "aria-expanded"?: boolean;
  }>
>(function DoubleTapHeartText(
  { momentId, className, children, onSingleTap, "aria-expanded": ariaExpanded },
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
      aria-expanded={ariaExpanded}
      onClick={(event) => onTap(event.detail)}
    >
      {children}
    </blockquote>
  );
});
