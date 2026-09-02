import Link from "next/link";
import type { ReactNode } from "react";
import type { SaveFamilyMomentAction } from "@/features/composer/moment-composer";
import { PhotoStatusShelf } from "@/features/composer/photo-status-shelf";
import { PrimaryNavigation } from "./primary-navigation";
import { TimelineHeaderComposer } from "./timeline-header-composer";
import { ThemeToggle } from "./theme-toggle";
import { NotificationCenter } from "./notification-center";
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
  const hasJournalActions = ["timeline", "people", "memories"].includes(
    section,
  );
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
          {hasJournalActions ? (
            <TimelineHeaderComposer
              composer={model.composer}
              createMomentAction={createMomentAction}
            />
          ) : (
            <span className="topbar-leading-spacer" aria-hidden="true" />
          )}
          <div className="title-lockup">
            <span className="eyebrow">{model.eyebrow}</span>
            <h1 id="journal-focus-target" tabIndex={-1}>
              {model.title}
            </h1>
          </div>
          {hasJournalActions ? (
            <div className="topbar-actions">
              <NotificationCenter items={model.notifications} />
              <ThemeToggle />
            </div>
          ) : section === "settings" ? (
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
          ) : (
            <ThemeToggle />
          )}
        </header>
        {section === "timeline" &&
        model.composer.photoPostingEnabled &&
        model.composer.circleId ? (
          <PhotoStatusShelf
            circleId={model.composer.circleId}
            today={model.composer.previewToday}
          />
        ) : null}
        {children}
        <PrimaryNavigation
          section={section}
          memoriesHref={model.memoriesHref}
          settingsHref={model.settingsHref}
        />
      </section>
    </main>
  );
}
