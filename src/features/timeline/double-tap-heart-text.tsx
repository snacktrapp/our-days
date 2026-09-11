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
  }>
>(function DoubleTapHeartText(
  { momentId, className, children, onSingleTap },
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
      onClick={(event) => onTap(event.detail)}
    >
      {children}
    </blockquote>
  );
});
