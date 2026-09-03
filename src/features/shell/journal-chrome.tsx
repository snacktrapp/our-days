import Link from "next/link";
import type { ReactNode } from "react";
import type { SaveFamilyMomentAction } from "@/features/composer/moment-composer";
import { ComposerSessionProvider } from "@/features/composer/composer-session";
import { PhotoLightboxRoot } from "@/features/timeline/photo-lightbox";
import { PrimaryNavigation } from "./primary-navigation";
import { TimelineHeaderComposer } from "./timeline-header-composer";
import { ThemeToggle } from "./theme-toggle";
import { NotificationCenter } from "./notification-center";
import {
  FamilyTitleSwitcher,
  StaticJournalTitle,
  type FamilyTimelineSwitcherItem,
} from "./family-title-switcher";
import type {
  JournalSection,
  JournalChromeViewModel,
} from "./shell-view-model";

export type { FamilyTimelineSwitcherItem };

type JournalChromeProps = Readonly<{
  model: JournalChromeViewModel;
  section: JournalSection;
  children: ReactNode;
  createMomentAction?: SaveFamilyMomentAction;
  standaloneNavigation?: boolean;
  switcher?: readonly FamilyTimelineSwitcherItem[];
}>;

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
      <StaticJournalTitle model={model} />
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
      <StaticJournalTitle model={model} />
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
      <PhotoLightboxRoot>
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
      </PhotoLightboxRoot>
    </ComposerSessionProvider>
  );
}
