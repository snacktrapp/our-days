"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

export type JournalBannerVariant = "enablement" | "feature" | "tip";

type JournalBannerCta =
  | {
      kind: "pill";
      label: string;
      href: string;
      onClick?: () => void;
    }
  | {
      kind: "quiet";
      label: string;
      href: string;
      onClick?: () => void;
    }
  | {
      kind: "pill" | "quiet";
      label: string;
      onClick: () => void;
    };

export type JournalBannerProps = Readonly<{
  variant: JournalBannerVariant;
  title: string;
  body: string;
  cta: JournalBannerCta;
  showNotNow?: boolean;
  promoId?: string;
  onDismiss: () => void;
}>;

function restoreFocusAfterBanner() {
  const dateMarker = document.querySelector<HTMLElement>(".date-marker");
  const target = dateMarker ?? document.getElementById("journal-focus-target");
  target?.focus({ preventScroll: true });
}

function BannerDismissIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

function BannerBellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.2 16.4h11.6s-1.3-1.5-1.3-5.1a4.5 4.5 0 1 0-9 0c0 3.6-1.3 5.1-1.3 5.1Z" />
      <path d="M10.2 18.1a1.8 1.8 0 0 0 3.6 0" />
    </svg>
  );
}

function BannerSparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" />
      <path d="M12 8.4 13.4 12l3.6.4-2.7 2.2.8 3.5L12 16.6 9.9 18.1l.8-3.5-2.7-2.2 3.6-.4L12 8.4Z" />
    </svg>
  );
}

function BannerBulbIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 15a5.5 5.5 0 1 1 5 0c-.6.9-1 1.7-1 3H10.5c0-1.3-.4-2.1-1-3Z" />
      <path d="M10 18.5h4M10.5 21h3" />
    </svg>
  );
}

function variantIcon(variant: JournalBannerVariant) {
  switch (variant) {
    case "feature":
      return <BannerSparkleIcon />;
    case "tip":
      return <BannerBulbIcon />;
    default:
      return <BannerBellIcon />;
  }
}

function QuietChevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 7.5 14.5 12l-5 4.5" />
    </svg>
  );
}

function ctaClassName(cta: JournalBannerCta, variant: JournalBannerVariant) {
  return cta.kind === "pill"
    ? `journal-banner-cta journal-banner-cta-pill journal-banner-cta-pill-${variant}`
    : "journal-banner-cta journal-banner-cta-quiet";
}

export function JournalBanner({
  variant,
  title,
  body,
  cta,
  showNotNow = false,
  promoId,
  onDismiss,
}: JournalBannerProps) {
  const titleId = useId();
  const bannerRef = useRef<HTMLElement>(null);
  const onDismissRef = useRef(onDismiss);
  const [motionState, setMotionState] = useState<
    "enter" | "visible" | "fade" | "collapse"
  >("enter");
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMotionState("visible");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const beginDismiss = () => {
    if (motionState === "fade" || motionState === "collapse") return;
    const height = bannerRef.current?.getBoundingClientRect().height ?? 0;
    setMeasuredHeight(height);
    setMotionState("fade");
  };

  useEffect(() => {
    if (motionState !== "fade") return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const fadeMs = reducedMotion ? 0 : 140;
    const fadeTimer = window.setTimeout(() => {
      setMotionState("collapse");
      setMeasuredHeight(0);
    }, fadeMs);
    return () => window.clearTimeout(fadeTimer);
  }, [motionState]);

  useEffect(() => {
    if (motionState !== "collapse") return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const collapseMs = reducedMotion ? 0 : 160;
    const collapseTimer = window.setTimeout(() => {
      onDismissRef.current();
      restoreFocusAfterBanner();
    }, collapseMs);
    return () => window.clearTimeout(collapseTimer);
  }, [motionState]);

  const style: CSSProperties | undefined =
    measuredHeight === null
      ? undefined
      : ({
          ["--journal-banner-height" as string]: `${measuredHeight}px`,
        } as CSSProperties);

  return (
    <aside
      ref={bannerRef}
      className="journal-banner"
      data-variant={variant}
      data-promo={promoId}
      data-motion={motionState}
      role="status"
      aria-labelledby={titleId}
      style={style}
    >
      <span className="journal-banner-badge" aria-hidden="true">
        {variantIcon(variant)}
      </span>
      <h2 id={titleId} className="journal-banner-title">
        {title}
      </h2>
      <p className="journal-banner-body">{body}</p>
      <div className="journal-banner-actions">
        {"href" in cta ? (
          <Link
            className={ctaClassName(cta, variant)}
            href={cta.href}
            prefetch={false}
            onClick={cta.onClick}
          >
            {cta.label}
            {cta.kind === "quiet" ? <QuietChevron /> : null}
          </Link>
        ) : (
          <button
            type="button"
            className={ctaClassName(cta, variant)}
            onClick={() => {
              cta.onClick();
              beginDismiss();
            }}
          >
            {cta.label}
            {cta.kind === "quiet" ? <QuietChevron /> : null}
          </button>
        )}
        {showNotNow ? (
          <button
            type="button"
            className="journal-banner-not-now"
            onClick={beginDismiss}
          >
            Not now
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="journal-banner-dismiss"
        aria-label="Dismiss"
        onClick={beginDismiss}
      >
        <BannerDismissIcon />
      </button>
    </aside>
  );
}
