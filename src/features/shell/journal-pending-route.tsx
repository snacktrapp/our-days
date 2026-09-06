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

export type PendingJournalRoute = Readonly<{
  href: string;
  kind: JournalSkeletonKind;
}>;

type JournalPendingRouteValue = Readonly<{
  pending: PendingJournalRoute | null;
  begin: (href: string) => void;
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
  if (pending.kind === "people") {
    return { ...model, title: "Our people" };
  }
  if (pending.kind === "memories") {
    return { ...model, title: "Memories" };
  }
  if (pending.kind === "settings") {
    return { ...model, title: "Account" };
  }
  return model;
}

export function RoutePendingSkeleton({
  kind,
}: Readonly<{ kind: JournalSkeletonKind }>) {
  const label =
    kind === "timeline"
      ? "Opening this journal"
      : kind === "people"
        ? "Opening people"
        : kind === "memories"
          ? "Opening memories"
          : "Opening account";

  if (kind === "timeline") {
    return (
      <section
        className="timeline route-pending-skeleton"
        aria-busy="true"
        aria-label={label}
      >
        <div className="time-rail" aria-hidden="true" />
        <div className="route-pending-card" />
        <div className="route-pending-card" />
        <div className="route-pending-card is-short" />
      </section>
    );
  }

  return (
    <section
      className={`section-panel route-pending-skeleton route-pending-${kind}`}
      aria-busy="true"
      aria-label={label}
    >
      {kind === "memories" ? <div className="route-pending-block" /> : null}
      <div className="route-pending-row" />
      <div className="route-pending-row" />
      <div className="route-pending-row" />
    </section>
  );
}

export function JournalPendingRouteProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? "";
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const currentPath = pathWithoutSearch(pathname);

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
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener(
        "our-days:navigate-section",
        onNavigateSection,
      );
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [begin]);

  const value = useMemo(() => {
    const pendingKind = pendingHref
      ? skeletonKindFromPathname(pendingHref)
      : null;
    const pending =
      pendingHref &&
      pendingKind &&
      pathWithoutSearch(pendingHref) !== currentPath
        ? { href: pendingHref, kind: pendingKind }
        : null;
    return { pending, begin };
  }, [begin, currentPath, pendingHref]);

  return (
    <JournalPendingRouteContext.Provider value={value}>
      {children}
    </JournalPendingRouteContext.Provider>
  );
}
