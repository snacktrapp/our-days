import type { ReactNode } from "react";

export function SettingsDisclosure({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={`settings-disclosure ${className}`}>
      <summary>
        <span>{label}</span>
        <span className="circle-accordion-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="m4.5 6 3.5 3.5L11.5 6" />
          </svg>
        </span>
      </summary>
      {children}
    </details>
  );
}
