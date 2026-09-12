import { JournalChrome } from "@/features/shell/journal-chrome";
import { PhoneNotificationsAnnouncement } from "@/features/timeline/phone-notifications-announcement";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedTimeline } from "@/data/moments.server";
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
  const access = await requireJournalAccess({ circleId: params.circle });
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
  const context = await loadConnectedJournalContext(access);
  const model = await loadConnectedTimeline(access, context, {
    pages: Number(pages ?? "1"),
    snapshotAt: snapshot,
    allCircles: !params.circle,
  });
  return (
    <JournalChrome
      model={model.chrome}
      section="timeline"
      createMomentAction={createFamilyMomentAction}
      switcher={model.switcher}
      onSelectGroup={selectActiveGroupAction}
    >
      <PhoneNotificationsAnnouncement />
      <TimelineFeed
        model={model}
        connectedActions={{
          update: updateFamilyMomentAction,
          trash: trashWrittenMomentAction,
          setAudience: setMomentAudienceAction,
          removePhoto: removeMomentPhotoAction,
          reorderPhotos: reorderMomentPhotosAction,
        }}
        conversationActions={{
          load: loadMomentConversationAction,
          createNote: createMomentNoteAction,
          updateNote: updateMomentNoteAction,
          trashNote: trashMomentNoteAction,
          setReaction: setMomentReactionAction,
        }}
      />
    </JournalChrome>
  );
}
