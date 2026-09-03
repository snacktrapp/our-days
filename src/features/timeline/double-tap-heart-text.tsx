"use client";

import { forwardRef, type ReactNode } from "react";
import { dispatchMomentHeart, usePairedTap } from "./double-tap-heart";

export const DoubleTapHeartText = forwardRef<
  HTMLQuoteElement,
  Readonly<{
    momentId: string;
    className?: string;
    children: ReactNode;
  }>
>(function DoubleTapHeartText({ momentId, className, children }, ref) {
  const onTap = usePairedTap({
    onDoubleTap: () => dispatchMomentHeart(momentId),
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
