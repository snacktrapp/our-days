"use client";

import Link from "next/link";
import { useRef } from "react";
import type { JournalChromeViewModel } from "./shell-view-model";
import { useOverlayPopoverClose } from "./use-overlay-popover-close";

export type FamilyTimelineSwitcherItem = Readonly<{
  label: string;
  href: string;
  current: boolean;
}>;

function TitleCopy({
  model,
  chevron = false,
}: Readonly<{
  model: JournalChromeViewModel;
  chevron?: boolean;
}>) {
  return (
    <>
      <span className="eyebrow">{model.eyebrow}</span>
      {chevron ? (
        <span className="title-switcher-heading">
          <h1 id="journal-focus-target" tabIndex={-1}>
            {model.title}
          </h1>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4.5 6 3.5 3.5L11.5 6" />
          </svg>
        </span>
      ) : (
        <h1 id="journal-focus-target" tabIndex={-1}>
          {model.title}
        </h1>
      )}
    </>
  );
}

export function StaticJournalTitle({
  model,
}: Readonly<{ model: JournalChromeViewModel }>) {
  return (
    <div className="title-lockup">
      <TitleCopy model={model} />
    </div>
  );
}

export function FamilyTitleSwitcher({
  model,
  switcher,
}: Readonly<{
  model: JournalChromeViewModel;
  switcher: readonly FamilyTimelineSwitcherItem[];
}>) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { closing, requestClose, cancel, onAnimationEnd } =
    useOverlayPopoverClose();

  return (
    <details
      ref={detailsRef}
      className="title-switcher"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) cancel();
      }}
    >
      <summary
        className="title-lockup"
        onClick={(event) => {
          const details = detailsRef.current;
          if (!details?.open) return;
          event.preventDefault();
          if (closing) return;
          requestClose(() => {
            details.open = false;
          });
        }}
      >
        <TitleCopy model={model} chevron />
      </summary>
      <nav
        className={closing ? "is-closing" : undefined}
        aria-label="Choose a family timeline"
        aria-hidden={closing ? true : undefined}
        onAnimationEnd={onAnimationEnd}
      >
        {switcher.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={item.current ? "page" : undefined}
            className={item.current ? "active" : ""}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
