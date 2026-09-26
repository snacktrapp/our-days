import { Suspense } from "react";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { NotificationCenter } from "@/features/shell/notification-center";
import { OpeningJournalShell } from "@/features/shell/opening-journal-shell";
import { JournalPromos } from "@/features/timeline/journal-promos";
import {
  hasSharedCircle,
  type JournalPromoContext,
} from "@/features/timeline/journal-promo-config";
import type { FamilyTimelineSwitcherItem } from "@/features/shell/journal-switcher";
import {
  TimelineFeed,
  TimelineFeedEntries,
} from "@/features/timeline/timeline-feed";
import { RoutePendingSkeleton } from "@/features/shell/journal-pending-route";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { slicePreviewTimelineForNotification } from "@/features/timeline/notification-preview";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import type { JournalAccess } from "@/lib/auth/journal-access";
import {
  familyHomeRefreshSoftFail,
  loadFamilyHomeChrome,
  loadFamilyHomeOpeningTimeline,
  loadFamilyHomeRemainder,
  loadFamilyHomeTimelineList,
} from "@/data/family-home.server";
import { loadJournalActivityNotifications } from "@/data/journal-context.server";
import { selectActiveGroupAction } from "@/features/groups/create-group-action";
import { labJournalDataDelay } from "@/data/lab-journal-delay.server";
import { timePageData } from "@/lib/page-data-timing.server";
import { previewGroupOptions } from "@/data/preview-groups.server";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
  setMomentNoteHeartAction,
  setMomentReactionAction,
  removeMomentPhotoAction,
  reorderMomentPhotosAction,
  trashWrittenMomentAction,
  trashMomentNoteAction,
  updateFamilyMomentAction,
  updateMomentNoteAction,
  setMomentAudienceAction,
} from "@/features/moments/moment-actions";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

const connectedActions = {
  update: updateFamilyMomentAction,
  trash: trashWrittenMomentAction,
  setAudience: setMomentAudienceAction,
  removePhoto: removeMomentPhotoAction,
  reorderPhotos: reorderMomentPhotosAction,
};

function journalPromoContext(
  signedIn: boolean,
  switcher: readonly FamilyTimelineSwitcherItem[] | undefined,
): JournalPromoContext {
  return {
    signedIn,
    sharedCircle: hasSharedCircle(
      (switcher ?? []).filter((item) => item.kind === "group"),
    ),
  };
}

const conversationActions = {
  load: loadMomentConversationAction,
  createNote: createMomentNoteAction,
  updateNote: updateMomentNoteAction,
  trashNote: trashMomentNoteAction,
  setReaction: setMomentReactionAction,
  setNoteHeart: setMomentNoteHeartAction,
};

async function FamilyActivity({
  access,
  memberNames,
}: Readonly<{
  access: AuthenticatedAccess;
  memberNames?: Readonly<Record<string, string>>;
}>) {
  const items = await loadJournalActivityNotifications(access, memberNames);
  return <NotificationCenter items={items} refreshOnOpen />;
}

async function FamilyTimelineRest({
  remainder,
}: Readonly<{
  remainder: Promise<Awaited<ReturnType<typeof loadFamilyHomeRemainder>>>;
}>) {
  const model = await remainder;
  return (
    <TimelineFeedEntries
      model={model}
      connectedActions={connectedActions}
      conversationActions={conversationActions}
      connectedOffset={1}
    />
  );
}

async function FamilyTimeline({
  access,
  context,
  options,
}: Readonly<{
  access: AuthenticatedAccess;
  context: NonNullable<
    Awaited<ReturnType<typeof loadFamilyHomeChrome>>["context"]
  >;
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>;
}>) {
  const sharedTimelineList = loadFamilyHomeTimelineList(
    access,
    context,
    options,
  );
  const remainder = loadFamilyHomeRemainder(
    access,
    context,
    options,
    sharedTimelineList,
  );
  const opening = await timePageData(() =>
    loadFamilyHomeOpeningTimeline(access, context, options, sharedTimelineList),
  );
  if (!opening.streamRemainder) {
    void remainder.catch(() => undefined);
  }
  return (
    <TimelineFeed
      model={opening.model}
      connectedActions={connectedActions}
      conversationActions={conversationActions}
      trailing={
        opening.streamRemainder ? (
          <Suspense fallback={null}>
            <FamilyTimelineRest remainder={remainder} />
          </Suspense>
        ) : null
      }
    />
  );
}

async function ConnectedFamilyHome({
  access,
  options,
}: Readonly<{
  access: AuthenticatedAccess;
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>;
}>) {
  const { model, context } = await loadFamilyHomeChrome(access, options);
  const promoContext = journalPromoContext(true, model.switcher);
  if (!context) {
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
        preserveChrome
      >
        <JournalPromos context={promoContext} />
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  return (
    <JournalChrome
      model={model.chrome}
      section="timeline"
      createMomentAction={createFamilyMomentAction}
      switcher={model.switcher}
      onSelectGroup={selectActiveGroupAction}
      activity={
        <Suspense fallback={<NotificationCenter items={[]} refreshOnOpen />}>
          <FamilyActivity access={access} memberNames={context.memberNames} />
        </Suspense>
      }
    >
      <JournalPromos context={promoContext} />
      <Suspense fallback={<RoutePendingSkeleton kind="timeline" />}>
        <FamilyTimeline access={access} context={context} options={options} />
      </Suspense>
    </JournalChrome>
  );
}

export default async function FamilyPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    pages?: string;
    snapshot?: string;
    circle?: string;
    name?: string;
    moment?: string;
    note?: string;
    thread?: string;
  }>;
}>) {
  const params = await searchParams;
  const access = await requireJournalAccessUnlessRecoverable({
    circleId: params.circle,
  });
  if (!access) {
    const model = familyHomeRefreshSoftFail(!params.circle);
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
        preserveChrome
      >
        <JournalPromos context={journalPromoContext(false, model.switcher)} />
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    await timePageData(() => labJournalDataDelay());
    const model = slicePreviewTimelineForNotification(
      getFamilyTimelineFixture(await previewGroupOptions(params)),
      params,
    );
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
      >
        <JournalPromos context={journalPromoContext(false, model.switcher)} />
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  const { pages, snapshot } = params;
  return (
    <Suspense fallback={<OpeningJournalShell />}>
      <ConnectedFamilyHome
        access={access}
        options={{
          pages,
          snapshotAt: snapshot,
          circleId: params.circle,
        }}
      />
    </Suspense>
  );
}
