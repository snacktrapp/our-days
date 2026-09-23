import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { NavSymbol } from "@/features/shell/nav-symbol";

export function SettingsPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const classes = ["settings-page", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}

export function SettingsSection({
  children,
  id,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <section
      className="settings-section-block"
      id={id}
      aria-label={ariaLabel}
    >
      {children}
    </section>
  );
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>;
}

export function SettingsSectionLabel({
  children,
  more,
}: {
  children: ReactNode;
  more?: ReactNode;
}) {
  return (
    <div className="settings-section-label">
      <span>{children}</span>
      {more ?? null}
    </div>
  );
}

export function SettingsMoreButton({
  label,
  expanded,
  controls,
  disabled,
  onClick,
}: {
  label: string;
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="settings-more-button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">···</span>
    </button>
  );
}

export function SettingsRowCopy({
  title,
  subtitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <span className="settings-row-copy">
      <strong>{title}</strong>
      {subtitle ? <small>{subtitle}</small> : null}
    </span>
  );
}

export function SettingsChevron() {
  return (
    <span className="settings-chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="m6 4 4 4-4 4" />
      </svg>
    </span>
  );
}

export function SettingsRowTrail({ children }: { children?: ReactNode }) {
  return <span className="settings-row-trail">{children}</span>;
}

export function SettingsRow({
  plain = false,
  action = false,
  className: extraClassName,
  children,
}: {
  plain?: boolean;
  action?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const className = [
    "settings-row",
    plain ? "is-plain" : "",
    action ? "is-action" : "",
    extraClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={className}>{children}</div>;
}

export function SettingsRowLink({
  href,
  plain = false,
  action = false,
  ariaLabel,
  children,
}: {
  href: string;
  plain?: boolean;
  action?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const className = [
    "settings-row",
    "settings-row-link",
    plain ? "is-plain" : "",
    action ? "is-action" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Link
      className={className}
      href={href}
      prefetch={false}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

export function SettingsRowButton({
  plain = false,
  action = false,
  ariaLabel,
  ariaExpanded,
  ariaControls,
  disabled,
  buttonRef,
  onClick,
  children,
}: {
  plain?: boolean;
  action?: boolean;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  disabled?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  children: ReactNode;
}) {
  const className = [
    "settings-row",
    "settings-row-button",
    plain ? "is-plain" : "",
    action ? "is-action" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SettingsAvatar({
  accent,
  initial,
  pending = false,
  add = false,
  tile = false,
}: {
  accent?: string;
  initial?: string;
  pending?: boolean;
  add?: boolean;
  tile?: boolean;
}) {
  if (tile) {
    return (
      <span className="settings-avatar settings-avatar-tile" aria-hidden="true">
        <NavSymbol name="circles" />
      </span>
    );
  }
  if (add) {
    return (
      <span className="settings-avatar settings-avatar-add" aria-hidden="true">
        +
      </span>
    );
  }
  const className = [
    "settings-avatar",
    pending ? "is-pending" : accent ? `dot-${accent}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={className} aria-hidden="true">
      {initial}
    </span>
  );
}

export function SettingsBackChevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 4 6 8l4 4" />
    </svg>
  );
}
