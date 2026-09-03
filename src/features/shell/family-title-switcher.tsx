"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
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

function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function SwitcherLinkLabel({
  holding,
  children,
}: Readonly<{
  holding: boolean;
  children: string;
}>) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={
        pending || holding
          ? "title-switcher-link-label title-switcher-link-pending"
          : "title-switcher-link-label"
      }
    >
      {children}
    </span>
  );
}

function SwitcherLink({
  item,
  current,
  onChoose,
}: Readonly<{
  item: FamilyTimelineSwitcherItem;
  current: boolean;
  onChoose: (item: FamilyTimelineSwitcherItem) => void;
}>) {
  const [holding, setHolding] = useState(false);

  function acknowledge(event: MouseEvent<HTMLAnchorElement>) {
    if (!isUnmodifiedPrimaryClick(event)) return;
    onChoose(item);
    if (current) return;
    setHolding(true);
  }

  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={current ? "page" : undefined}
      className={`${current ? "active" : ""}${holding ? " is-pending" : ""}`}
      onPointerDown={acknowledge}
      onClick={acknowledge}
    >
      <SwitcherLinkLabel holding={holding}>{item.label}</SwitcherLinkLabel>
    </Link>
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
  const [chosenHref, setChosenHref] = useState<string | null>(null);
  const { closing, closingRef, requestClose, cancel, onAnimationEnd } =
    useOverlayPopoverClose();
  const serverCurrentHref = switcher.find((item) => item.current)?.href ?? null;
  const currentHref = chosenHref ?? serverCurrentHref;
  const chosenItem = switcher.find((item) => item.href === currentHref);
  const displayModel =
    chosenItem && chosenHref && chosenItem.href.startsWith("/people/")
      ? { ...model, title: chosenItem.label }
      : model;

  function chooseItem(item: FamilyTimelineSwitcherItem) {
    setChosenHref(item.href);
    window.dispatchEvent(
      new CustomEvent("our-days:navigate-section", {
        detail: { href: item.href },
      }),
    );
  }

  useEffect(() => {
    const closeIfOpen = () => {
      const details = detailsRef.current;
      if (!details?.open || closingRef.current) return;
      requestClose(() => {
        details.open = false;
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!detailsRef.current?.open) return;
      event.preventDefault();
      closeIfOpen();
    };
    const onPointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.target instanceof Node && details.contains(event.target)) {
        return;
      }
      closeIfOpen();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [closingRef, requestClose]);

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
        <TitleCopy model={displayModel} chevron />
      </summary>
      <nav
        className={closing ? "is-closing" : undefined}
        aria-label="Choose a family timeline"
        aria-hidden={closing ? true : undefined}
        onAnimationEnd={onAnimationEnd}
      >
        {switcher.map((item) => (
          <SwitcherLink
            key={item.href}
            item={item}
            current={item.href === currentHref}
            onChoose={chooseItem}
          />
        ))}
      </nav>
    </details>
  );
}
