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

export type FamilyTimelineSwitcherItem = Readonly<{
  label: string;
  href: string;
  current: boolean;
}>;

type JournalChromeProps = Readonly<{
  model: JournalChromeViewModel;
  section: JournalSection;
  children: ReactNode;
  createMomentAction?: SaveFamilyMomentAction;
  standaloneNavigation?: boolean;
  switcher?: readonly FamilyTimelineSwitcherItem[];
}>;

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
      {chevron ? (
        <span className="title-switcher-heading">
          <h1 id="journal-focus-target" tabIndex={-1}>
            {model.title}
          </h1>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4.5 6 3.5 3.5L11.5 6" />
          </svg>
        </span>
      ) : (
        <h1 id="journal-focus-target" tabIndex={-1}>
          {model.title}
        </h1>
      )}
    </>
  );
}

function FamilyTitleSwitcher({
  model,
  switcher,
}: Readonly<{
  model: JournalChromeViewModel;
  switcher: readonly FamilyTimelineSwitcherItem[];
}>) {
  return (
    <details className="title-switcher">
      <summary className="title-lockup">
        <TitleCopy model={model} chevron />
      </summary>
      <nav aria-label="Choose a family timeline">
        {switcher.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={item.current ? "page" : undefined}
            className={item.current ? "active" : ""}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}

function PrimaryJournalHeader({
  model,
  createMomentAction,
  switcher,
}: Readonly<{
  model: JournalChromeViewModel;
  createMomentAction?: SaveFamilyMomentAction;
  switcher?: readonly FamilyTimelineSwitcherItem[];
}>) {
  const title =
    switcher && switcher.length > 0 ? (
      <FamilyTitleSwitcher model={model} switcher={switcher} />
    ) : (
      <div className="title-lockup">
        <TitleCopy model={model} />
      </div>
    );

  return (
    <header className="topbar">
      <TimelineHeaderComposer
        composer={model.composer}
        createMomentAction={createMomentAction}
      />
      {title}
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
        <TitleCopy model={model} />
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
  switcher,
}: JournalChromeProps) {
  const header =
    section === "trash" ? (
      <TrashHeader model={model} />
    ) : (
      <PrimaryJournalHeader
        model={model}
        createMomentAction={createMomentAction}
        switcher={switcher}
      />
    );

  return (
    <ComposerSessionProvider
      model={model.composer}
      createMomentAction={createMomentAction}
    >
      {header}
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
          {children}
          {standaloneNavigation ? (
            <PrimaryNavigation
              section={section}
              memoriesHref={model.memoriesHref}
              settingsHref={model.settingsHref}
            />
          ) : null}
        </section>
      </main>
    </ComposerSessionProvider>
  );
}
