import type { MomentAudience } from "./moment-audience";

export type MentionWrite = Readonly<{
  userId: string;
  start: number;
  end: number;
}>;

export type MomentActionResult = Readonly<{
  ok: boolean;
  message: string;
  momentId?: string;
  revision?: number;
}>;

export type EditableMomentKind = "thought" | "milestone" | "location";

export type SaveFamilyMomentAction = (input: {
  journalPersonId: string;
  kind: EditableMomentKind;
  title: string;
  body: string;
  placeName: string;
  latitude?: number | null;
  longitude?: number | null;
  taggedPersonIds: readonly string[];
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  audience?: MomentAudience;
  circleIds?: readonly string[];
  mentions?: readonly MentionWrite[];
}) => Promise<MomentActionResult>;

export type SaveWrittenMomentAction = (input: {
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  audience?: MomentAudience;
  circleIds?: readonly string[];
  mentions?: readonly MentionWrite[];
}) => Promise<MomentActionResult>;

export type UpdateFamilyMomentAction = (input: {
  shareToCircleId?: string;
  momentId: string;
  revision: number;
  title: string;
  body: string;
  placeName: string;
  latitude?: number | null;
  longitude?: number | null;
  taggedPersonIds: readonly string[];
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  audience?: MomentAudience;
  circleIds?: readonly string[];
  mentions?: readonly MentionWrite[];
}) => Promise<MomentActionResult>;

export type SetMomentAudienceAction = (input: {
  momentId: string;
  revision: number;
  audience: MomentAudience;
  circleIds?: readonly string[];
}) => Promise<MomentActionResult>;

export type ChangeTrashAction = (input: {
  momentId: string;
  revision: number;
}) => Promise<MomentActionResult>;

export type RemoveMomentPhotoAction = (input: {
  momentId: string;
  photoId: string;
}) => Promise<MomentActionResult>;

export type ReorderMomentPhotosAction = (input: {
  momentId: string;
  photoIds: readonly string[];
}) => Promise<MomentActionResult>;

export type ConnectedMomentActions = Readonly<{
  update: UpdateFamilyMomentAction;
  trash: ChangeTrashAction;
  setAudience?: SetMomentAudienceAction;
  removePhoto?: RemoveMomentPhotoAction;
  reorderPhotos?: ReorderMomentPhotosAction;
}>;

export type MomentConversationActions = Readonly<{
  load: (input: { momentId: string }) => Promise<
    | Readonly<{
        ok: true;
        conversation: import("@/features/timeline/timeline-view-model").MomentConversationViewModel;
      }>
    | Readonly<{ ok: false; message: string }>
  >;
  createNote: (input: {
    momentId: string;
    body: string;
    mentions?: readonly MentionWrite[];
  }) => Promise<MomentActionResult>;
  updateNote: (input: {
    noteId: string;
    momentId?: string;
    revision: number;
    body: string;
    mentions?: readonly MentionWrite[];
  }) => Promise<MomentActionResult>;
  trashNote: (input: {
    noteId: string;
    revision: number;
  }) => Promise<MomentActionResult>;
  setReaction: (input: {
    momentId: string;
    reactionId: string | null;
  }) => Promise<MomentActionResult>;
  setNoteHeart: (input: {
    noteId: string;
    momentId: string;
    hearted: boolean;
  }) => Promise<MomentActionResult>;
}>;
