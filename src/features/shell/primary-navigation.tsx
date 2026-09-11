"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useComposerSession } from "@/features/composer/composer-session";
import { sectionFromPathname } from "./journal-routes";
import type { JournalSection } from "./shell-view-model";
import { useCompactBottomNavOnScroll } from "./use-compact-bottom-nav-on-scroll";
import { usePinBottomNavToVisualViewport } from "./use-pin-bottom-nav-to-visual-viewport";

type PrimarySection = Extract<JournalSection, "timeline" | "settings">;

function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function NavIcon({ name }: { name: "family" | "add" | "account" }) {
  if (name === "family") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 11.2v1.6" style={{ strokeWidth: 2.15 }} />
        <rect x="5.5" y="5" width="13" height="5.2" rx="1.6" />
        <rect x="5.5" y="13.8" width="13" height="5.2" rx="1.6" />
      </svg>
    );
  }
  if (name === "add") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
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

function NavSymbol({ name }: { name: "family" | "add" | "account" }) {
  return (
    <span className="nav-symbol" aria-hidden="true">
      <NavIcon name={name} />
    </span>
  );
}

export function PrimaryNavigation({
  section,
  settingsHref,
}: {
  section: JournalSection;
  settingsHref?: string | null;
}) {
  const pathname = usePathname() ?? "";
  const compact = useCompactBottomNavOnScroll();
  const pinToVisualViewport = usePinBottomNavToVisualViewport();
  const session = useComposerSession();
  const addMomentRef = useRef<HTMLButtonElement>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    fromPathname: string;
    section: PrimarySection;
  } | null>(null);
  const selectedSection =
    pendingSelection?.fromPathname === pathname
      ? pendingSelection.section
      : (sectionFromPathname(pathname) ?? section);
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
      if (!nextSection || nextSection === "memories") return;
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
        window.dispatchEvent(
          new CustomEvent("our-days:navigate-section", {
            detail: { href: event.currentTarget.getAttribute("href") },
          }),
        );
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
        <NavSymbol name="family" />
        <span>Journal</span>
      </Link>
      <button
        ref={addMomentRef}
        className="nav-item"
        type="button"
        aria-expanded={session?.isOpen ?? false}
        onClick={() => {
          // Match Post-to to the journal you're looking at. Forcing Just me from
          // Family made videos appear briefly, then vanish after refresh.
          const onPersonalJournal = pathname.startsWith("/people/");
          session?.toggleCreate(
            addMomentRef.current,
            onPersonalJournal ? { defaultAudience: "just_me" } : undefined,
          );
        }}
      >
        <NavSymbol name="add" />
        <span>Add</span>
      </button>
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
          <NavSymbol name="account" />
          <span>Account</span>
        </Link>
      )}
    </nav>
  );
}
