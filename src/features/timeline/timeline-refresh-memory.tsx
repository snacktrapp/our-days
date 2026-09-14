"use client";

import { useRef, type ReactNode } from "react";
import {
  isJournalLoadSoftFail,
  preferPriorTimelineOnRefresh,
  type TimelineViewModel,
} from "./timeline-view-model";

export function TimelineRefreshMemory({
  model,
  children,
}: {
  model: TimelineViewModel;
  children: (resolved: TimelineViewModel) => ReactNode;
}) {
  const prior = useRef(model);
  const resolved = preferPriorTimelineOnRefresh(prior.current, model);
  if (!isJournalLoadSoftFail(resolved)) {
    prior.current = resolved;
  }
  return children(resolved);
}
