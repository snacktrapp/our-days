export type LocalMomentKind =
  "thought" | "milestone" | "location" | "photo" | "video";

export type LocalPerson = Readonly<{
  id: string;
  displayName: string;
  profileKind: "account" | "managed";
  accentToken: "clay" | "gold" | "sage" | "sky";
  createdAt: string;
}>;

export type LocalMembership = Readonly<{
  id: string;
  personId: string;
  role: "organizer" | "member";
  status: "active";
  joinedAt: string;
}>;

export type LocalAccount = Readonly<{
  email: string;
  personId: string;
  membershipId: string;
}>;

export type LocalGuardian = Readonly<{
  managedPersonId: string;
  guardianMembershipId: string;
}>;

export type LocalMedia = Readonly<{
  mimeType: string;
  byteLength: number;
  sha256: string;
  originalRelativePath: string;
  displayRelativePath?: string;
  displayMimeType?: string;
  displayByteLength?: number;
  displaySha256?: string;
  durationMs?: number;
}>;

export type LocalMoment = Readonly<{
  id: string;
  journalPersonId: string;
  recordedByMembershipId: string;
  kind: LocalMomentKind;
  title: string;
  body: string;
  placeName: string;
  taggedPersonIds: readonly string[];
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  trashedByMembershipId: string | null;
  media?: LocalMedia;
}>;

export type LocalNote = Readonly<{
  id: string;
  momentId: string;
  authorMembershipId: string;
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}>;

export type LocalReaction = Readonly<{
  id: string;
  momentId: string;
  authorMembershipId: string;
  reactionType: "held-close" | "made-me-smile" | "remember-this";
  createdAt: string;
  removedAt: string | null;
}>;

export type LocalJournalDocument = Readonly<{
  version: 1;
  circle: Readonly<{
    id: string;
    name: string;
    timeZone: string;
  }>;
  people: readonly LocalPerson[];
  memberships: readonly LocalMembership[];
  accounts: readonly LocalAccount[];
  guardians: readonly LocalGuardian[];
  moments: readonly LocalMoment[];
  notes: readonly LocalNote[];
  reactions: readonly LocalReaction[];
}>;
