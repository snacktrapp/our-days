"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  isJournalLoadSoftFail,
  preferPriorTimelineOnRefresh,
  type TimelineViewModel,
} from "./timeline-view-model";

type TimelineSnapshot = Readonly<{
  model: TimelineViewModel;
  content: ReactNode;
}>;

function createTimelineSnapshotStore(initial: TimelineSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(next: TimelineSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

export function TimelineRefreshMemory({
  model,
  children,
  afterContent,
}: {
  model: TimelineViewModel;
  children: ReactNode;
  afterContent?: ReactNode;
}) {
  const [store] = useState(() =>
    createTimelineSnapshotStore({ model, content: children }),
  );
  const prior = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const usePriorContent =
    preferPriorTimelineOnRefresh(prior.model, model) !== model;

  useEffect(() => {
    if (isJournalLoadSoftFail(model)) return;
    const snapshot = store.getSnapshot();
    if (snapshot.model === model && snapshot.content === children) return;
    store.setSnapshot({ model, content: children });
  }, [model, children, store]);

  return (
    <>
      {usePriorContent ? prior.content : children}
      {afterContent}
    </>
  );
}
