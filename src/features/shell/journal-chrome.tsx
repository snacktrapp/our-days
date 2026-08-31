import Link from "next/link";
import type { ReactNode } from "react";
import type { SaveFamilyMomentAction } from "@/features/composer/moment-composer";
import { PhotoStatusShelf } from "@/features/composer/photo-status-shelf";
import { PrimaryNavigation } from "./primary-navigation";
import type {
  JournalSection,
  JournalChromeViewModel,
} from "./shell-view-model";

type JournalChromeProps = Readonly<{
  model: JournalChromeViewModel;
  section: JournalSection;
  children: ReactNode;
  createMomentAction?: SaveFamilyMomentAction;
}>;

export function JournalChrome({
  model,
  section,
  children,
  createMomentAction,
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
        <p
          id="journal-live-region"
          className="sr-only"
          aria-live="assertive"
          aria-atomic="true"
        />
        <header className="topbar">
          {section === "settings" || model.settingsHref === null ? (
            <span className="family-mark" aria-hidden="true">
              {familyBadges}
            </span>
          ) : (
            <Link
              className="family-mark"
              aria-label="Open family settings"
              href={model.settingsHref ?? "/settings/family"}
              prefetch={false}
            >
              {familyBadges}
            </Link>
          )}
          <div className="title-lockup">
            <span className="eyebrow">{model.eyebrow}</span>
            <h1 id="journal-focus-target" tabIndex={-1}>
              {model.title}
            </h1>
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
          ) : section === "trash" ? (
            <Link
              className="quiet-button settings-close-link"
              aria-label="Back to Family"
              href="/family"
              prefetch={false}
            >
              ←
            </Link>
          ) : model.timelineOptionsHref ? (
            <Link
              className="quiet-button"
              aria-label="Open timeline options"
              href={model.timelineOptionsHref}
              prefetch={false}
            >
              •••
            </Link>
          ) : (
            <button className="quiet-button" aria-label="Timeline options">
              •••
            </button>
          )}
        </header>
        {model.composer.photoPostingEnabled && model.composer.circleId ? (
          <PhotoStatusShelf circleId={model.composer.circleId} />
        ) : null}
        {children}
        <PrimaryNavigation
          composer={model.composer}
          section={section}
          createMomentAction={createMomentAction}
          memoriesHref={model.memoriesHref}
        />
      </section>
    </main>
  );
}
