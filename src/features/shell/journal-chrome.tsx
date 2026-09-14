"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { SaveFamilyMomentAction } from "@/features/composer/moment-composer";
import { ComposerSessionProvider } from "@/features/composer/composer-session";
import { PhotoStatusShelf } from "@/features/composer/photo-status-shelf";
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
import {
  JournalPendingRouteProvider,
  RoutePendingSkeleton,
  pendingChromeModel,
  usePendingJournalRoute,
} from "./journal-pending-route";
import type {
  JournalSection,
  JournalChromeViewModel,
} from "./shell-view-model";
import { currentHomeContext } from "./journal-switcher";

export type { FamilyTimelineSwitcherItem };

type JournalChromeProps = Readonly<{
  model: JournalChromeViewModel;
  section: JournalSection;
  children: ReactNode;
  activity?: ReactNode;
  createMomentAction?: SaveFamilyMomentAction;
  standaloneNavigation?: boolean;
  switcher?: readonly FamilyTimelineSwitcherItem[];
  onSelectGroup?: (circleId: string) => void;
  preserveChrome?: boolean;
}>;

function PrimaryJournalHeader({
  model,
  activity,
  createMomentAction,
  switcher,
  onSelectGroup,
}: Readonly<{
  model: JournalChromeViewModel;
  activity?: ReactNode;
  createMomentAction?: SaveFamilyMomentAction;
  switcher?: readonly FamilyTimelineSwitcherItem[];
  onSelectGroup?: (circleId: string) => void;
}>) {
  const title =
    switcher && switcher.length > 0 ? (
      <FamilyTitleSwitcher
        model={model}
        switcher={switcher}
        onSelectGroup={onSelectGroup}
      />
    ) : (
      <StaticJournalTitle model={model} />
    );

  return (
    <header className="topbar">
      <TimelineHeaderComposer
        composer={model.composer}
        createMomentAction={createMomentAction}
        homeContext={currentHomeContext(switcher)}
      />
      {title}
      <div className="topbar-actions">
        {activity ?? <NotificationCenter items={model.notifications} />}
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

function JournalStage({
  model,
  section,
  children,
  activity,
  createMomentAction,
  switcher,
  onSelectGroup,
}: JournalChromeProps) {
  const pendingRoute = usePendingJournalRoute();
  const pending = pendingRoute?.pending ?? null;
  const chromeModel = pendingChromeModel(model, pending);
  const header =
    section === "trash" ? (
      <TrashHeader model={chromeModel} />
    ) : (
      <PrimaryJournalHeader
        model={chromeModel}
        activity={activity}
        createMomentAction={createMomentAction}
        switcher={switcher}
        onSelectGroup={onSelectGroup}
      />
    );

  return (
    <>
      {header}
      {model.composer.circleId ? (
        <PhotoStatusShelf circleId={model.composer.circleId} />
      ) : null}
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
          {pending ? <RoutePendingSkeleton kind={pending.kind} /> : children}
        </section>
      </main>
      <PrimaryNavigation section={section} settingsHref={model.settingsHref} />
    </>
  );
}

export function JournalChrome({
  model,
  section,
  children,
  activity,
  createMomentAction,
  switcher,
  onSelectGroup,
  preserveChrome = false,
}: JournalChromeProps) {
  const [retained, setRetained] = useState({ model, switcher });
  if (
    !preserveChrome &&
    (retained.model !== model || retained.switcher !== switcher)
  ) {
    setRetained({ model, switcher });
  }
  const chrome = preserveChrome ? retained.model : model;
  const shownSwitcher = preserveChrome ? retained.switcher : switcher;

  return (
    <ComposerSessionProvider
      model={chrome.composer}
      createMomentAction={createMomentAction}
      homeContext={currentHomeContext(shownSwitcher)}
    >
      <PhotoLightboxRoot>
        <JournalPendingRouteProvider>
          <JournalStage
            model={chrome}
            section={section}
            activity={activity}
            createMomentAction={createMomentAction}
            switcher={shownSwitcher}
            onSelectGroup={onSelectGroup}
          >
            {children}
          </JournalStage>
        </JournalPendingRouteProvider>
      </PhotoLightboxRoot>
    </ComposerSessionProvider>
  );
}
