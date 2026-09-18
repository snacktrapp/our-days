import Link from "next/link";

export function SettingsLink({
  href = "/settings/family",
}: {
  href?: string | null;
}) {
  if (href === null)
    return <span className="topbar-leading-spacer" aria-hidden="true" />;
  return (
    <Link
      href={href}
      className="header-settings"
      aria-label="Settings"
      prefetch={false}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 4V2h6v2l2 1 2-1 3 5-2 1v3l2 1-3 5-2-1-2 1v3H9v-3l-2-1-2 1-3-5 2-1v-3L2 9l3-5 2 1Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </Link>
  );
}
