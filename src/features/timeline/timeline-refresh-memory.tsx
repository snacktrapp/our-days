"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  isJournalLoadSoftFail,
  preferPriorTimelineOnRefresh,
  type TimelineViewModel,
} from "./timeline-view-model";

export function TimelineRefreshMemory({
  model,
  children,
  afterContent,
}: {
  model: TimelineViewModel;
  children: ReactNode;
  afterContent?: ReactNode;
}) {
  const [prior, setPrior] = useState({ model, content: children });
  const usePriorContent = preferPriorTimelineOnRefresh(prior.model, model) !== model;

  useEffect(() => {
    if (isJournalLoadSoftFail(model)) return;
    setPrior({ model, content: children });
  }, [model, children]);

  return (
    <>
      {usePriorContent ? prior.content : children}
      {afterContent}
    </>
  );
}
