import Link from "next/link";
import type { ReactNode } from "react";
import type { SaveFamilyMomentAction } from "@/features/composer/moment-composer";
import { ComposerSessionProvider } from "@/features/composer/composer-session";
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
  standaloneNavigation?: boolean;
}>;

function PrimaryJournalHeader({
  model,
  createMomentAction,
}: Readonly<{
  model: JournalChromeViewModel;
  createMomentAction?: SaveFamilyMomentAction;
}>) {
  return (
    <header className="topbar">
      <TimelineHeaderComposer
        composer={model.composer}
        createMomentAction={createMomentAction}
      />
      <div className="title-lockup">
        <span className="eyebrow">{model.eyebrow}</span>
        <h1 id="journal-focus-target" tabIndex={-1}>
          {model.title}
        </h1>
      </div>
      <div className="topbar-actions">
        <NotificationCenter items={model.notifications} />
        <ThemeToggle />
      </div>
    </header>
  );
}

function TrashHeader({ model }: Readonly<{ model: JournalChromeViewModel }>) {
  return (
    <header className="topbar">
      <span className="topbar-leading-spacer" aria-hidden="true" />
      <div className="title-lockup">
        <span className="eyebrow">{model.eyebrow}</span>
        <h1 id="journal-focus-target" tabIndex={-1}>
          {model.title}
        </h1>
      </div>
      <Link
        className="quiet-button settings-close-link"
        aria-label="Back to Family"
        href="/family"
        prefetch={false}
      >
        ←
      </Link>
    </header>
  );
}

export function JournalChrome({
  model,
  section,
  children,
  createMomentAction,
  standaloneNavigation = false,
}: JournalChromeProps) {
  return (
    <main className={`app-shell theme-${model.accent}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <ComposerSessionProvider
        model={model.composer}
        createMomentAction={createMomentAction}
      >
        {section === "trash" ? (
          <TrashHeader model={model} />
        ) : (
          <PrimaryJournalHeader
            model={model}
            createMomentAction={createMomentAction}
          />
        )}
        <section className="phone-stage" aria-label="Family journal">
          <p
            id="journal-live-region"
            className="sr-only"
            aria-live="assertive"
            aria-atomic="true"
          />
          {children}
          {standaloneNavigation ? (
            <PrimaryNavigation
              section={section}
              memoriesHref={model.memoriesHref}
              settingsHref={model.settingsHref}
            />
          ) : null}
        </section>
      </ComposerSessionProvider>
    </main>
  );
}
