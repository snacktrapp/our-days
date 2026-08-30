import Link from "next/link";
import type { ReactNode } from "react";
import { PrimaryNavigation } from "./primary-navigation";
import type {
  JournalSection,
  JournalChromeViewModel,
} from "./shell-view-model";

type JournalChromeProps = Readonly<{
  model: JournalChromeViewModel;
  section: JournalSection;
  children: ReactNode;
}>;

export function JournalChrome({
  model,
  section,
  children,
}: JournalChromeProps) {
  const familyBadges = model.familyMark.map((badge) => (
    <span
      key={badge.id}
      className={`family-mark-dot dot-${badge.accent}`}
      aria-hidden="true"
    >
      {badge.initial}
    </span>
  ));

  return (
    <main className={`app-shell theme-${model.accent}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="phone-stage" aria-label="Family journal">
        <header className="topbar">
          {section === "settings" ? (
            <span className="family-mark" aria-hidden="true">
              {familyBadges}
            </span>
          ) : (
            <Link
              className="family-mark"
              aria-label="Open family settings"
              href="/settings/family"
              prefetch={false}
            >
              {familyBadges}
            </Link>
          )}
          <div className="title-lockup">
            <span className="eyebrow">{model.eyebrow}</span>
            <h1>{model.title}</h1>
          </div>
          {section === "settings" ? (
            <Link
              className="quiet-button settings-close-link"
              aria-label="Back to People"
              href="/people"
              prefetch={false}
            >
              ←
            </Link>
          ) : (
            <button className="quiet-button" aria-label="Timeline options">
              •••
            </button>
          )}
        </header>
        {children}
        <PrimaryNavigation composer={model.composer} section={section} />
      </section>
    </main>
  );
}
