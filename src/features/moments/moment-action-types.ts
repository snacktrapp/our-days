export type MomentActionResult = Readonly<{
  ok: boolean;
  message: string;
  momentId?: string;
  revision?: number;
}>;

export type SaveWrittenMomentAction = (input: {
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
}) => Promise<MomentActionResult>;

export type UpdateWrittenMomentAction = (input: {
  momentId: string;
  revision: number;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
}) => Promise<MomentActionResult>;

export type ChangeTrashAction = (input: {
  momentId: string;
  revision: number;
}) => Promise<MomentActionResult>;

export type ConnectedMomentActions = Readonly<{
  update: UpdateWrittenMomentAction;
  trash: ChangeTrashAction;
}>;
