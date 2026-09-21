"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import {
  JournalShellContext,
  useJournalShell,
  type JournalShellRegistration,
} from "./journal-shell-context";
import { fallbackJournalChrome } from "@/data/journal-chrome-fallback";
import type { SaveFamilyMomentAction } from "@/features/composer/moment-composer";
import { ComposerSessionProvider } from "@/features/composer/composer-session";
import { PhotoStatusShelf } from "@/features/composer/photo-status-shelf";
import { PrimaryNavigation } from "./primary-navigation";
import { SettingsLink } from "./settings-link";
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
import { sectionHeading } from "./journal-heading";
import { useScrollAwayHeader } from "./use-scroll-away-header";

export type { FamilyTimelineSwitcherItem };

export type JournalChromeProps = Readonly<{
  model: JournalChromeViewModel;
  section: JournalSection;
  children: ReactNode;
  activity?: ReactNode;
  createMomentAction?: SaveFamilyMomentAction;
  standaloneNavigation?: boolean;
  switcher?: readonly FamilyTimelineSwitcherItem[];
  onSelectGroup?: (circleId: string) => void;
  preserveChrome?: boolean;
  backToCirclesHref?: string;
}>;

function PrimaryJournalHeader({
  model,
  activity,
  switcher,
  onSelectGroup,
  browsingCircle,
}: Readonly<{
  model: JournalChromeViewModel;
  activity?: ReactNode;
  browsingCircle?: boolean;
  switcher?: readonly FamilyTimelineSwitcherItem[];
  onSelectGroup?: (circleId: string) => void;
}>) {
  const headerRef = useScrollAwayHeader();
  const title =
    !browsingCircle && switcher && switcher.length > 0 ? (
      <FamilyTitleSwitcher
        model={model}
        switcher={switcher}
        onSelectGroup={onSelectGroup}
      />
    ) : (
      <StaticJournalTitle model={model} />
    );

  return (
    <header ref={headerRef} className="topbar">
      <SettingsLink href={model.settingsHref} />
      {title}
      <div className="topbar-actions">
        {activity ?? (
          <NotificationCenter
            items={model.notifications}
            refreshOnOpen={
              model.composer.experience === "connected-family" ||
              model.composer.experience === "connected-written"
            }
          />
        )}
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
  switcher,
  onSelectGroup,
  backToCirclesHref,
}: JournalChromeProps) {
  const pendingRoute = usePendingJournalRoute();
  const pending = pendingRoute?.pending ?? null;
  const heading = sectionHeading(section);
  const chromeModel = pendingChromeModel(
    heading ? { ...model, ...heading } : model,
    pending,
  );
  const current = switcher?.find((item) => item.current);
  const browsingCircle = Boolean(
    backToCirclesHref ||
    current?.kind === "group" ||
    current?.kind === "person",
  );
  const backHref =
    backToCirclesHref ??
    (current?.circleId
      ? `/circles#circle-${encodeURIComponent(current.circleId)}`
      : "/circles");
  const header =
    section === "trash" ? (
      <TrashHeader model={chromeModel} />
    ) : (
      <PrimaryJournalHeader
        model={chromeModel}
        activity={activity}
        switcher={pending && pending.kind !== "timeline" ? undefined : switcher}
        browsingCircle={browsingCircle}
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
          {pending ? <RoutePendingSkeleton kind={pending.kind} /> : null}
          <div className="journal-route-content" hidden={Boolean(pending)}>
            {browsingCircle && !pending ? (
              <Link
                className="circle-back-link"
                href={backHref}
                prefetch={false}
              >
                ← Back to Circles
              </Link>
            ) : null}
            {children}
          </div>
        </section>
      </main>
      <PrimaryNavigation
        section={browsingCircle ? "circles" : section}
        justMeHref={
          switcher?.find((item) => item.kind === "you")?.href ??
          (model.composer.recorderPersonId
            ? `/people/${model.composer.recorderPersonId}`
            : undefined)
        }
      />
    </>
  );
}

function StandaloneJournalChrome({
  model,
  section,
  children,
  activity,
  createMomentAction,
  switcher,
  onSelectGroup,
  preserveChrome = false,
  backToCirclesHref,
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
      <JournalPendingRouteProvider>
        <JournalStage
          model={chrome}
          section={section}
          activity={activity}
          createMomentAction={createMomentAction}
          switcher={shownSwitcher}
          onSelectGroup={onSelectGroup}
          backToCirclesHref={backToCirclesHref}
        >
          {children}
        </JournalStage>
      </JournalPendingRouteProvider>
    </ComposerSessionProvider>
  );
}

const openingModel = fallbackJournalChrome(
  { circleId: "", personId: "" },
  { title: "Our Days", eyebrow: "Journal" },
);

/** Lives above loading/error boundaries; route pages supply data, not new navs. */
export function PersistentJournalShell({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<JournalShellRegistration>({
    model: openingModel,
    section: "timeline",
  });
  const register = useCallback((next: JournalShellRegistration) => {
    setPage((previous) =>
      next.preserveChrome && previous.model.composer.recorderPersonId
        ? { ...next, model: previous.model, switcher: previous.switcher }
        : next,
    );
  }, []);
  useEffect(() => {
    const clear = () => setPage({ model: openingModel, section: "timeline" });
    window.addEventListener("our-days:clear-private-state", clear);
    return () =>
      window.removeEventListener("our-days:clear-private-state", clear);
  }, []);
  return (
    <JournalShellContext.Provider value={register}>
      <StandaloneJournalChrome {...page} preserveChrome={false}>
        {children}
      </StandaloneJournalChrome>
    </JournalShellContext.Provider>
  );
}

function RegisteredJournalPage({
  register,
  ...props
}: JournalChromeProps & {
  register: (page: JournalShellRegistration) => void;
}) {
  const finish = usePendingJournalRoute()?.finish;
  const {
    model,
    section,
    activity,
    createMomentAction,
    switcher,
    onSelectGroup,
    preserveChrome,
    backToCirclesHref,
  } = props;
  useLayoutEffect(() => {
    register({
      model,
      section,
      activity,
      createMomentAction,
      switcher,
      onSelectGroup,
      preserveChrome,
      backToCirclesHref,
    });
    finish?.();
  }, [
    register,
    finish,
    model,
    section,
    activity,
    createMomentAction,
    switcher,
    onSelectGroup,
    preserveChrome,
    backToCirclesHref,
  ]);
  return props.children;
}

export function JournalChrome(props: JournalChromeProps) {
  const register = useJournalShell();
  return register ? (
    <RegisteredJournalPage {...props} register={register} />
  ) : (
    <StandaloneJournalChrome {...props} />
  );
}
