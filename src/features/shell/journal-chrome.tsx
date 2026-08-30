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
  return (
    <main className={`app-shell theme-${model.accent}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="phone-stage" aria-label="Family journal">
        <header className="topbar">
          <Link
            className="family-mark"
            aria-label="Open family settings"
            href="/people"
            prefetch={false}
          >
            {model.familyMark.map((badge) => (
              <span
                key={badge.id}
                className={`family-mark-dot dot-${badge.accent}`}
                aria-hidden="true"
              >
                {badge.initial}
              </span>
            ))}
          </Link>
          <div className="title-lockup">
            <span className="eyebrow">{model.eyebrow}</span>
            <h1>{model.title}</h1>
          </div>
          <button className="quiet-button" aria-label="Timeline options">
            •••
          </button>
        </header>
        {children}
        <PrimaryNavigation composer={model.composer} section={section} />
      </section>
    </main>
  );
}
