"use client";

import Link from "next/link";
import type { JournalSection } from "./shell-view-model";

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

export function PrimaryNavigation({
  section,
  memoriesHref,
  settingsHref,
}: {
  section: JournalSection;
  memoriesHref?: string | null;
  settingsHref?: string | null;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <Link
        className={`nav-item ${section === "timeline" ? "active" : ""}`}
        aria-current={section === "timeline" ? "page" : undefined}
        href="/family"
        prefetch={false}
      >
        <span className="nav-symbol" aria-hidden="true">
          <NavIcon name="family" />
        </span>
        <span>Family</span>
      </Link>
      <Link
        className={`nav-item ${section === "people" ? "active" : ""}`}
        aria-current={section === "people" ? "page" : undefined}
        href="/people"
        prefetch={false}
      >
        <span className="nav-symbol" aria-hidden="true">
          <NavIcon name="people" />
        </span>
        <span>People</span>
      </Link>
      {memoriesHref === null ? (
        <span className="nav-item nav-item-unavailable" aria-hidden="true" />
      ) : (
        <Link
          className={`nav-item ${section === "memories" ? "active" : ""}`}
          aria-current={section === "memories" ? "page" : undefined}
          href={memoriesHref ?? "/memories"}
          prefetch={false}
        >
          <span className="nav-symbol" aria-hidden="true">
            <NavIcon name="memories" />
          </span>
          <span>Memories</span>
        </Link>
      )}
      {settingsHref === null ? (
        <span className="nav-item nav-item-unavailable" aria-hidden="true" />
      ) : (
        <Link
          className={`nav-item ${section === "settings" ? "active" : ""}`}
          aria-current={section === "settings" ? "page" : undefined}
          href={settingsHref ?? "/settings/family"}
          prefetch={false}
        >
          <span className="nav-symbol" aria-hidden="true">
            <NavIcon name="account" />
          </span>
          <span>Account</span>
        </Link>
      )}
    </nav>
  );
}
