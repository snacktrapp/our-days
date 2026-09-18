"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useComposerSession } from "@/features/composer/composer-session";
import { sectionFromPathname } from "./journal-routes";
import { JournalHomeLink } from "./journal-home-link";
import type { JournalSection } from "./shell-view-model";
import { useHideBottomNavWhileComposing } from "./hide-bottom-nav-while-composing";
import { useCompactBottomNavOnScroll } from "./use-compact-bottom-nav-on-scroll";
import { usePinBottomNavToVisualViewport } from "./use-pin-bottom-nav-to-visual-viewport";

type PrimarySection = Extract<
  JournalSection,
  "timeline" | "circles" | "settings"
>;

function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function NavIcon({ name }: { name: "family" | "add" | "circles" }) {
  if (name === "family") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 11.2v1.6" strokeWidth={2.15} />
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
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.65" />
    </svg>
  );
}

function NavSymbol({ name }: { name: "family" | "add" | "circles" }) {
  return (
    <span className="nav-symbol" aria-hidden="true">
      <NavIcon name={name} />
    </span>
  );
}

export function PrimaryNavigation({
  section,
  justMeHref,
}: {
  section: JournalSection;
  justMeHref?: string;
}) {
  const pathname = usePathname() ?? "";
  const compact = useCompactBottomNavOnScroll();
  const pinToVisualViewport = usePinBottomNavToVisualViewport();
  const session = useComposerSession();
  const hidden = useHideBottomNavWhileComposing(session?.isOpen ?? false);
  const addMomentRef = useRef<HTMLButtonElement>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    fromPathname: string;
    section: PrimarySection;
  } | null>(null);
  const selectedSection =
    pendingSelection?.fromPathname === pathname
      ? pendingSelection.section
      : section === "circles"
        ? "circles"
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
      className={`bottom-nav${compact ? " is-compact" : ""}${hidden ? " is-hidden" : ""}`}
      aria-label="Primary navigation"
      aria-hidden={hidden ? true : undefined}
      inert={hidden ? true : undefined}
    >
      <JournalHomeLink
        className={`nav-item ${selectedSection === "timeline" ? "active" : ""}`}
        aria-current={selectedSection === "timeline" ? "page" : undefined}
        justMeHref={justMeHref}
        onJournalNavigate={(href) => {
          pinToVisualViewport();
          setPendingSelection({ fromPathname: pathname, section: "timeline" });
          window.dispatchEvent(
            new CustomEvent("our-days:navigate-section", {
              detail: { href },
            }),
          );
        }}
      >
        <NavSymbol name="family" />
        <span>Journal</span>
      </JournalHomeLink>
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
      <Link
        className={`nav-item ${selectedSection === "circles" ? "active" : ""}`}
        aria-current={selectedSection === "circles" ? "page" : undefined}
        href="/circles"
        onClick={selectImmediately("circles")}
        prefetch={false}
      >
        <NavSymbol name="circles" />
        <span>Circles</span>
      </Link>
    </nav>
  );
}
