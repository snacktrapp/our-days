"use client";

import type { ReactNode } from "react";
import { dispatchMomentHeart, usePairedTap } from "./double-tap-heart";

export function DoubleTapHeartText({
  momentId,
  className,
  children,
}: Readonly<{
  momentId: string;
  className?: string;
  children: ReactNode;
}>) {
  const onTap = usePairedTap({
    onDoubleTap: () => dispatchMomentHeart(momentId),
  });

  return (
    <blockquote className={className} onClick={(event) => onTap(event.detail)}>
      {children}
    </blockquote>
  );
}
