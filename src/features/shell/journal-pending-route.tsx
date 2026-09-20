"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  pathWithoutSearch,
  skeletonKindFromPathname,
  type JournalSkeletonKind,
} from "./journal-routes";
import type { JournalChromeViewModel } from "./shell-view-model";
import { useJournalShell } from "./journal-shell-context";

export type PendingJournalRoute = Readonly<{
  href: string;
  kind: JournalSkeletonKind;
}>;

type JournalPendingRouteValue = Readonly<{
  pending: PendingJournalRoute | null;
  begin: (href: string) => void;
  finish: () => void;
}>;

const JournalPendingRouteContext =
  createContext<JournalPendingRouteValue | null>(null);

function isUnmodifiedPrimaryClick(event: globalThis.MouseEvent) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function usePendingJournalRoute() {
  return useContext(JournalPendingRouteContext);
}

export function pendingChromeModel(
  model: JournalChromeViewModel,
  pending: PendingJournalRoute | null,
): JournalChromeViewModel {
  if (!pending) return model;
  if (pending.kind === "people") return { ...model, title: "Circles" };
  if (pending.kind === "memories") {
    return { ...model, title: "Memories" };
  }
  if (pending.kind === "settings") {
    return { ...model, title: "Account" };
  }
  if (pending.kind === "timeline") {
    const ownHref = `/people/${model.composer?.recorderPersonId}`;
    if (pending.href === ownHref || pending.href === "/journal?view=you")
      return { ...model, title: "Just me", eyebrow: "Just me" };
    if (pending.href === "/family")
      return { ...model, title: "All circles", eyebrow: "Circles" };
  }
  return model;
}

export function RoutePendingSkeleton({
  kind,
}: Readonly<{ kind: JournalSkeletonKind }>) {
  const label =
    kind === "timeline"
      ? "Opening this journal"
      : kind === "memories"
        ? "Opening memories"
        : kind === "people"
          ? "Opening circles"
          : "Opening account";

  return (
    <section
      className={`route-pending-field route-pending-skeleton route-pending-${kind}`}
      aria-busy="true"
      aria-label={label}
    />
  );
}

export function JournalPendingRouteProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? "";
  const persistent = Boolean(useJournalShell());
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const finish = useCallback(() => setPendingHref(null), []);
  const currentPath = pathWithoutSearch(pathname);
  const [committedPath, setCommittedPath] = useState(currentPath);

  // A completed (or redirected) navigation consumes its pending destination.
  // Otherwise Back can revive that destination and hide an already loaded feed.
  if (committedPath !== currentPath) {
    setCommittedPath(currentPath);
    if (!persistent) setPendingHref(null);
  }

  const begin = useCallback(
    (href: string) => {
      const kind = skeletonKindFromPathname(href);
      if (!kind) return;
      if (pathWithoutSearch(href) === currentPath) return;
      setPendingHref(href);
    },
    [currentPath],
  );

  useEffect(() => {
    const onNavigateSection = (event: Event) => {
      const href =
        event && typeof event === "object" && "detail" in event
          ? (event as { detail?: { href?: unknown } }).detail?.href
          : undefined;
      if (typeof href !== "string") return;
      begin(href);
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isUnmodifiedPrimaryClick(event)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      begin(href);
    };
    window.addEventListener("our-days:navigate-section", onNavigateSection);
    window.addEventListener("popstate", finish);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener(
        "our-days:navigate-section",
        onNavigateSection,
      );
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener("popstate", finish);
    };
  }, [begin, finish]);

  const value = useMemo(() => {
    const pendingKind = pendingHref
      ? skeletonKindFromPathname(pendingHref)
      : null;
    const pending =
      pendingHref &&
      pendingKind &&
      (persistent || pathWithoutSearch(pendingHref) !== currentPath)
        ? { href: pendingHref, kind: pendingKind }
        : null;
    return { pending, begin, finish };
  }, [begin, finish, currentPath, pendingHref, persistent]);

  return (
    <JournalPendingRouteContext.Provider value={value}>
      {children}
    </JournalPendingRouteContext.Provider>
  );
}
