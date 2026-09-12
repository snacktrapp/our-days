"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import type { JournalChromeViewModel } from "./shell-view-model";
import { lockOverlayChrome, unlockOverlayChrome } from "./overlay-chrome";
import {
  sheetCloseMs,
  useOverlayPopoverClose,
} from "./use-overlay-popover-close";
import { useSheetDismiss } from "./use-sheet-dismiss";
import {
  groupHomeHref,
  isFamilyHomePath,
  journalSwitcherSections,
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
      <span className="eyebrow">{model.eyebrow}</span>
      <span className="title-switcher-heading">
        <h1 id="journal-focus-target" tabIndex={-1}>
          {model.title}
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

function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function SwitcherCheck() {
  return (
    <svg
      className="title-switcher-check"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="m3.5 8.2 3 3 6-6.4" />
    </svg>
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
  function acknowledge(event: MouseEvent<HTMLAnchorElement>) {
    if (!isUnmodifiedPrimaryClick(event)) return;
    event.preventDefault();
    onChoose(item);
  }

  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={current ? "page" : undefined}
      className={current ? "active" : undefined}
      onPointerDown={acknowledge}
      onClick={acknowledge}
    >
      <span className="title-switcher-check-slot" aria-hidden="true">
        {current ? <SwitcherCheck /> : null}
      </span>
      <span className="title-switcher-link-label">{item.label}</span>
      {item.kind === "group" && item.memberCount != null ? (
        <span className="title-switcher-member-count" aria-hidden="true">
          {item.memberCount}
        </span>
      ) : null}
    </Link>
  );
}

function SwitcherSection({
  title,
  items,
  currentHref,
  onChoose,
}: Readonly<{
  title: string;
  items: readonly FamilyTimelineSwitcherItem[];
  currentHref: string | null;
  onChoose: (item: FamilyTimelineSwitcherItem) => void;
}>) {
  if (items.length === 0) return null;
  return (
    <section className="title-switcher-section">
      <h3>{title}</h3>
      {items.map((item) => (
        <SwitcherLink
          key={item.href}
          item={item}
          current={item.href === currentHref}
          onChoose={onChoose}
        />
      ))}
    </section>
  );
}

export function FamilyTitleSwitcher({
  model,
  switcher,
  onSelectGroup,
}: Readonly<{
  model: JournalChromeViewModel;
  switcher: readonly FamilyTimelineSwitcherItem[];
  onSelectGroup?: (circleId: string) => void;
}>) {
  const router = useRouter();
  const panelId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [chosenHref, setChosenHref] = useState<string | null>(null);
  const [chosenFrom, setChosenFrom] = useState<string | null>(null);
  const { closing, closingRef, requestClose, cancel, onAnimationEnd } =
    useOverlayPopoverClose("sheet-down", sheetCloseMs);
  const serverCurrentHref = switcher.find((item) => item.current)?.href ?? null;
  const [observedHref, setObservedHref] = useState(serverCurrentHref);
  if (observedHref !== serverCurrentHref) {
    setObservedHref(serverCurrentHref);
    setOpen(false);
  }
  const currentHref =
    chosenHref && chosenFrom === serverCurrentHref
      ? chosenHref
      : serverCurrentHref;
  const chosenItem = switcher.find((item) => item.href === currentHref);
  const displayModel = chosenItem
    ? {
        ...model,
        title: chosenItem.label,
        eyebrow: journalSwitcherTypeLabel(chosenItem.kind),
      }
    : model;
  const sections = journalSwitcherSections(switcher);

  const closePanel = useCallback(() => {
    requestClose(() => {
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    });
  }, [requestClose]);

  const dismissGesture = useSheetDismiss({
    onDismiss: closePanel,
    scrollerRef,
    sheetRef,
  });

  const dialogMounted = useModalDialog(open, dialogRef);

  useLayoutEffect(() => {
    if (!dialogMounted) return;
    lockOverlayChrome();
    return () => unlockOverlayChrome();
  }, [dialogMounted]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open]);

  useEffect(() => {
    const remember = (href: string) => {
      setChosenHref(href);
      setChosenFrom(serverCurrentHref);
      setOpen(false);
      cancel();
    };
    const onNavigateSection = (event: Event) => {
      const href =
        event && typeof event === "object" && "detail" in event
          ? (event as { detail?: { href?: unknown } }).detail?.href
          : undefined;
      if (typeof href !== "string") return;
      const path = href.split("?")[0] ?? href;
      if (path !== "/family" && !path.startsWith("/people/")) return;
      const match = switcher.find((item) => item.href === href);
      remember(match?.href ?? (path === "/family" ? "/family" : href));
    };
    const onPopState = () => {
      const path = window.location.pathname;
      const circle = new URLSearchParams(window.location.search).get("circle");
      remember(
        isFamilyHomePath(path)
          ? circle
            ? groupHomeHref(circle)
            : "/family"
          : path,
      );
    };
    window.addEventListener("our-days:navigate-section", onNavigateSection);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener(
        "our-days:navigate-section",
        onNavigateSection,
      );
      window.removeEventListener("popstate", onPopState);
    };
  }, [cancel, serverCurrentHref, switcher]);

  function chooseItem(item: FamilyTimelineSwitcherItem) {
    setChosenHref(item.href);
    setChosenFrom(serverCurrentHref);
    cancel();
    setOpen(false);
    if (item.kind === "group" && item.circleId && onSelectGroup) {
      void Promise.resolve(onSelectGroup(item.circleId)).catch(() => {
        // Navigation still opens the circle via ?circle=; cookie write can
        // catch up on the next request if this action fails.
      });
    }
    router.push(item.href);
    window.dispatchEvent(
      new CustomEvent("our-days:navigate-section", {
        detail: { href: item.href },
      }),
    );
  }

  const toggle = () => {
    if (open) {
      if (closingRef.current) return;
      closePanel();
      return;
    }
    cancel();
    setOpen(true);
  };

  const sheet = (
    <dialog
      ref={dialogRef}
      id={panelId}
      className="composer-dialog activity-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      aria-hidden={closing ? true : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closePanel();
          return;
        }
        containDialogFocus(event);
      }}
      onCancel={(event) => {
        event.preventDefault();
        closePanel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closePanel();
      }}
    >
      <section
        ref={sheetRef}
        className={`composer-sheet activity-sheet title-switcher-sheet${closing ? " is-closing" : ""}`}
        onAnimationEnd={onAnimationEnd}
        onPointerDown={dismissGesture.onPointerDown}
        onPointerMove={dismissGesture.onPointerMove}
        onPointerUp={dismissGesture.onPointerUp}
        onPointerCancel={dismissGesture.onPointerCancel}
      >
        <div className="activity-sheet-chrome">
          <span className="sheet-handle" aria-hidden="true" />
          <header className="activity-sheet-bar">
            <h2 ref={headingRef} id={titleId} tabIndex={-1}>
              Journal
            </h2>
          </header>
        </div>
        <div ref={scrollerRef} className="activity-sheet-list">
          <nav aria-label="Choose a family timeline">
            <SwitcherSection
              title="Just me"
              items={sections.justMe}
              currentHref={currentHref}
              onChoose={chooseItem}
            />
            <SwitcherSection
              title="Circles"
              items={sections.circles}
              currentHref={currentHref}
              onChoose={chooseItem}
            />
            <SwitcherSection
              title="Person"
              items={sections.people}
              currentHref={currentHref}
              onChoose={chooseItem}
            />
          </nav>
        </div>
      </section>
    </dialog>
  );

  return (
    <div className={`title-switcher${open && !closing ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="title-lockup"
        aria-label="Choose a journal"
        aria-expanded={open && !closing}
        aria-controls={panelId}
        onClick={toggle}
      >
        <TitleCopy model={displayModel} chevron />
      </button>
      {dialogMounted && typeof document !== "undefined"
        ? createPortal(sheet, document.body)
        : null}
    </div>
  );
}
