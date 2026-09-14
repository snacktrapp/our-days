import { Suspense } from "react";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { NotificationCenter } from "@/features/shell/notification-center";
import { OpeningJournalShell } from "@/features/shell/opening-journal-shell";
import { PhoneNotificationsAnnouncement } from "@/features/timeline/phone-notifications-announcement";
import {
  TimelineFeed,
  TimelineFeedEntries,
} from "@/features/timeline/timeline-feed";
import { RoutePendingSkeleton } from "@/features/shell/journal-pending-route";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import type { JournalAccess } from "@/lib/auth/journal-access";
import {
  familyHomeRefreshSoftFail,
  loadFamilyHomeChrome,
  loadFamilyHomeFirstMoment,
  loadFamilyHomeRemainder,
} from "@/data/family-home.server";
import { loadJournalActivityNotifications } from "@/data/journal-context.server";
import { selectActiveGroupAction } from "@/features/groups/create-group-action";
import { previewGroupOptions } from "@/data/preview-groups.server";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
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

const conversationActions = {
  load: loadMomentConversationAction,
  createNote: createMomentNoteAction,
  updateNote: updateMomentNoteAction,
  trashNote: trashMomentNoteAction,
  setReaction: setMomentReactionAction,
};

async function FamilyActivity({
  access,
  memberNames,
}: Readonly<{
  access: AuthenticatedAccess;
  memberNames?: Readonly<Record<string, string>>;
}>) {
  const items = await loadJournalActivityNotifications(access, memberNames);
  return <NotificationCenter items={items} />;
}

async function FamilyTimelineRest({
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
  const model = await loadFamilyHomeRemainder(access, context, options);
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
  const first = await loadFamilyHomeFirstMoment(access, context, options);
  const showRemainder =
    !first.refreshDegraded &&
    first.entries.some((entry) => entry.entryType === "moment");
  return (
    <TimelineFeed
      model={first}
      connectedActions={connectedActions}
      conversationActions={conversationActions}
      trailing={
        showRemainder ? (
          <Suspense
            fallback={
              <div className="route-pending-card is-short" aria-hidden="true" />
            }
          >
            <FamilyTimelineRest
              access={access}
              context={context}
              options={options}
            />
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
  if (!context) {
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
        preserveChrome
      >
        <PhoneNotificationsAnnouncement />
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
        <Suspense fallback={<NotificationCenter items={[]} />}>
          <FamilyActivity access={access} memberNames={context.memberNames} />
        </Suspense>
      }
    >
      <PhoneNotificationsAnnouncement />
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
        <PhoneNotificationsAnnouncement />
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    const model = getFamilyTimelineFixture(await previewGroupOptions(params));
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
      >
        <PhoneNotificationsAnnouncement />
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
