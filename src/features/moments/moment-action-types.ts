import type { MomentAudience } from "./moment-audience";

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
}) => Promise<MomentActionResult>;

export type SaveWrittenMomentAction = (input: {
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  audience?: MomentAudience;
}) => Promise<MomentActionResult>;

export type UpdateFamilyMomentAction = (input: {
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
}) => Promise<MomentActionResult>;

export type ChangeTrashAction = (input: {
  momentId: string;
  revision: number;
}) => Promise<MomentActionResult>;

export type ConnectedMomentActions = Readonly<{
  update: UpdateFamilyMomentAction;
  trash: ChangeTrashAction;
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
  }) => Promise<MomentActionResult>;
  updateNote: (input: {
    noteId: string;
    revision: number;
    body: string;
  }) => Promise<MomentActionResult>;
  trashNote: (input: {
    noteId: string;
    revision: number;
  }) => Promise<MomentActionResult>;
  setReaction: (input: {
    momentId: string;
    reactionId: string | null;
  }) => Promise<MomentActionResult>;
}>;
