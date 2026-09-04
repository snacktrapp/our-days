"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import type { JournalSection } from "./shell-view-model";
import { useCompactBottomNavOnScroll } from "./use-compact-bottom-nav-on-scroll";
import { usePinBottomNavToVisualViewport } from "./use-pin-bottom-nav-to-visual-viewport";

type PrimarySection = Extract<
  JournalSection,
  "timeline" | "people" | "memories" | "settings"
>;

function sectionFromPathname(pathname: string | null): PrimarySection | null {
  const path = pathname ?? "";
  if (path === "/family" || path.startsWith("/journal")) {
    return "timeline";
  }
  if (path.startsWith("/people")) return "people";
  if (path.startsWith("/memories")) return "memories";
  if (path.startsWith("/settings")) return "settings";
  return null;
}

function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function NavIcon({
  name,
}: {
  name: "family" | "people" | "memories" | "account";
}) {
  if (name === "family") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 10.5 12 3.75l8.5 6.75" />
        <path d="M5.75 9.25v10h12.5v-10M9.5 19.25v-5.5h5v5.5" />
      </svg>
    );
  }
  if (name === "people") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.75 19c.45-3.45 2.2-5.25 5.25-5.25s4.8 1.8 5.25 5.25" />
        <path d="M14.75 5.75a3 3 0 0 1 0 5.5M16.25 14c2.3.55 3.65 2.2 4 5" />
      </svg>
    );
  }
  if (name === "memories") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14" rx="2" />
        <path d="M8 3.5v4M16 3.5v4M4 10h16" />
        <path d="m12 12.5.7 1.45 1.55.22-1.12 1.1.27 1.55-1.4-.74-1.4.74.27-1.55-1.12-1.1 1.55-.22Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 19c.55-3.7 2.7-5.6 6.5-5.6s5.95 1.9 6.5 5.6" />
      <path d="M18.5 4.75 20 6.25l-1.5 1.5" />
    </svg>
  );
}

function NavSymbol({
  name,
  holding,
}: {
  name: "family" | "people" | "memories" | "account";
  holding: boolean;
}) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={
        pending || holding ? "nav-symbol nav-symbol-pending" : "nav-symbol"
      }
      aria-hidden="true"
    >
      <NavIcon name={name} />
    </span>
  );
}

export function PrimaryNavigation({
  section,
  memoriesHref,
  settingsHref,
}: {
  section: JournalSection;
  memoriesHref?: string | null;
  settingsHref?: string | null;
}) {
  const pathname = usePathname() ?? "";
  const compact = useCompactBottomNavOnScroll();
  const pinToVisualViewport = usePinBottomNavToVisualViewport();
  const [pendingSelection, setPendingSelection] = useState<{
    fromPathname: string;
    section: PrimarySection;
  } | null>(null);
  const selectedSection =
    pendingSelection?.fromPathname === pathname
      ? pendingSelection.section
      : (sectionFromPathname(pathname) ?? section);
  const currentSection = sectionFromPathname(pathname) ?? section;
  const holdingSection =
    pendingSelection?.fromPathname === pathname &&
    pendingSelection.section !== currentSection
      ? pendingSelection.section
      : null;

  useEffect(() => {
    const onNavigateSection = (event: Event) => {
      const href =
        event && typeof event === "object" && "detail" in event
          ? (event as { detail?: { href?: unknown } }).detail?.href
          : undefined;
      if (typeof href !== "string") {
        return;
      }
      const nextSection = sectionFromPathname(href);
      if (!nextSection) return;
      setPendingSelection({ fromPathname: pathname, section: nextSection });
    };
    window.addEventListener("our-days:navigate-section", onNavigateSection);
    return () =>
      window.removeEventListener(
        "our-days:navigate-section",
        onNavigateSection,
      );
  }, [pathname]);

  const selectImmediately =
    (nextSection: PrimarySection) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!event.defaultPrevented && isUnmodifiedPrimaryClick(event)) {
        pinToVisualViewport();
        setPendingSelection({ fromPathname: pathname, section: nextSection });
      }
    };

  return (
    <nav
      className={`bottom-nav${compact ? " is-compact" : ""}`}
      aria-label="Primary navigation"
    >
      <Link
        className={`nav-item ${selectedSection === "timeline" ? "active" : ""}`}
        aria-current={selectedSection === "timeline" ? "page" : undefined}
        href="/family"
        onClick={selectImmediately("timeline")}
        prefetch={false}
      >
        <NavSymbol name="family" holding={holdingSection === "timeline"} />
        <span>Family</span>
      </Link>
      <Link
        className={`nav-item ${selectedSection === "people" ? "active" : ""}`}
        aria-current={selectedSection === "people" ? "page" : undefined}
        href="/people"
        onClick={selectImmediately("people")}
        prefetch={false}
      >
        <NavSymbol name="people" holding={holdingSection === "people"} />
        <span>People</span>
      </Link>
      {memoriesHref === null ? (
        <span className="nav-item nav-item-unavailable" aria-hidden="true" />
      ) : (
        <Link
          className={`nav-item ${selectedSection === "memories" ? "active" : ""}`}
          aria-current={selectedSection === "memories" ? "page" : undefined}
          href={memoriesHref ?? "/memories"}
          onClick={selectImmediately("memories")}
          prefetch={false}
        >
          <NavSymbol name="memories" holding={holdingSection === "memories"} />
          <span>Memories</span>
        </Link>
      )}
      {settingsHref === null ? (
        <span className="nav-item nav-item-unavailable" aria-hidden="true" />
      ) : (
        <Link
          className={`nav-item ${selectedSection === "settings" ? "active" : ""}`}
          aria-current={selectedSection === "settings" ? "page" : undefined}
          href={settingsHref ?? "/settings/family"}
          onClick={selectImmediately("settings")}
          prefetch={false}
        >
          <NavSymbol name="account" holding={holdingSection === "settings"} />
          <span>Account</span>
        </Link>
      )}
    </nav>
  );
}
