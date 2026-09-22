"use client";
import { OurDaysWordmark } from "@/components/our-days-wordmark";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { JournalChromeViewModel } from "./shell-view-model";
import { useJournalNavigationMemory } from "./journal-navigation-memory";
import { journalHeadings } from "./journal-heading";
import {
  journalSwitcherTypeLabel,
  type FamilyTimelineSwitcherItem,
} from "./journal-switcher";

export type {
  FamilyTimelineSwitcherItem,
  JournalSwitcherKind,
} from "./journal-switcher";

function TitleCopy({
  model,
  chevron = false,
}: Readonly<{
  model: JournalChromeViewModel;
  chevron?: boolean;
}>) {
  return (
    <>
      <OurDaysWordmark />
      <span className="title-switcher-heading">
        <h1 id="journal-focus-target" tabIndex={-1}>
          {model.title === "Our Days" ? "Journal" : model.title}
        </h1>
        {chevron ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4.5 6 3.5 3.5L11.5 6" />
          </svg>
        ) : null}
      </span>
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
  onSelectGroup?: (circleId: string) => void;
}>) {
  const router = useRouter();
  const { rememberJournal } = useJournalNavigationMemory();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const serverHref = switcher.find((item) => item.current)?.href ?? null;
  const [selection, setSelection] = useState({
    from: serverHref,
    href: serverHref,
  });
  const [observedHref, setObservedHref] = useState(serverHref);
  if (observedHref !== serverHref) {
    setObservedHref(serverHref);
    setSelection({ from: serverHref, href: serverHref });
    setOpen(false);
  }
  const currentHref =
    selection.from === serverHref ? selection.href : serverHref;
  const selected = switcher.find((item) => item.href === currentHref);
  const displayModel = selected
    ? {
        ...model,
        ...(selected.kind === "you" || selected.kind === "all"
          ? journalHeadings[selected.kind]
          : {
              title: selected.label,
              eyebrow: journalSwitcherTypeLabel(selected.kind),
            }),
      }
    : model;
  const items = switcher.filter(
    (item) => item.kind === "you" || item.kind === "all",
  );

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (!href) return;
      setOpen(false);
      if (switcher.some((item) => item.href === href))
        setSelection({ from: serverHref, href });
    };
    const back = () => {
      setOpen(false);
      setSelection({ from: serverHref, href: serverHref });
    };
    window.addEventListener("our-days:navigate-section", navigate);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("our-days:navigate-section", navigate);
      window.removeEventListener("popstate", back);
    };
  }, [serverHref, switcher]);

  return (
    <div
      ref={rootRef}
      className={`title-switcher${open ? " is-open" : ""}`}
      onBlur={(event) => {
        // Safari may blur the trigger to no focus target while a menu link
        // is being tapped. Removing the link here would swallow its click.
        // Outside taps already dismiss through the pointerdown listener.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const links = Array.from(
            rootRef.current?.querySelectorAll("nav a") ?? [],
          ) as HTMLAnchorElement[];
          const index = links.indexOf(
            document.activeElement as HTMLAnchorElement,
          );
          links[
            (index + (event.key === "ArrowDown" ? 1 : links.length - 1)) %
              links.length
          ]?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="title-lockup"
        aria-label="Choose a journal"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <TitleCopy model={displayModel} chevron />
      </button>
      {open ? (
        <nav id={panelId} aria-label="Choose a journal">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={item.href === currentHref ? "page" : undefined}
              className={item.href === currentHref ? "active" : undefined}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey ||
                  event.shiftKey
                )
                  return;
                event.preventDefault();
                rememberJournal(item.href);
                setSelection({ from: serverHref, href: item.href });
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
                router.push(item.href);
                window.dispatchEvent(
                  new CustomEvent("our-days:navigate-section", {
                    detail: { href: item.href },
                  }),
                );
              }}
            >
              <span className="title-switcher-check-slot" aria-hidden="true">
                {item.href === currentHref ? (
                  <svg className="title-switcher-check" viewBox="0 0 16 16">
                    <path d="m3.5 8.2 3 3 6-6.4" />
                  </svg>
                ) : null}
              </span>
              <span>{item.kind === "you" ? "Just me" : item.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
