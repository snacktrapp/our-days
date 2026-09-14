"use client";

import { useState, type ReactNode } from "react";
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
  const [prior, setPrior] = useState(model);
  const resolved = preferPriorTimelineOnRefresh(prior, model);
  if (!isJournalLoadSoftFail(model) && model !== prior) {
    setPrior(model);
  }
  return children(resolved);
}
