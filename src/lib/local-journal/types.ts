export type LocalMomentKind =
  "thought" | "milestone" | "location" | "photo" | "video" | "insight";

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
  role: "organizer" | "member" | "operations";
  directoryKind?: "journal" | "operations";
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
  posterRelativePath?: string;
  posterMimeType?: string;
  posterSha256?: string;
  posterByteLength?: number;
  widthPx?: number;
  heightPx?: number;
}>;

export type LocalMoment = Readonly<{
  id: string;
  circleId?: string;
  circleIds?: readonly string[];
  journalPersonId: string | null;
  recordedByMembershipId: string;
  audience?: "family" | "just_me";
  kind: LocalMomentKind;
  title: string;
  body: string;
  sourceUrl?: string | null;
  placeName: string;
  latitude?: number | null;
  longitude?: number | null;
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
  photos?: readonly (LocalMedia & { id: string })[];
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

export type LocalExtraCircle = Readonly<{
  id: string;
  name: string;
  timeZone: string;
  createdAt: string;
  membershipId: string;
  personId: string;
  displayName: string;
  accentToken: LocalPerson["accentToken"];
  role: LocalMembership["role"];
}>;

export type LocalEntryDraft = Readonly<{
  id: string;
  ownerPersonId: string;
  kind:
    "thought" | "photo" | "video" | "bible-verse" | "milestone" | "location";
  title: string;
  body: string;
  audience: "family" | "just_me";
  circleIds: readonly string[];
  journalPersonId: string | null;
  taggedPersonIds: readonly string[];
  placeName: string;
  latitude: number | null;
  longitude: number | null;
  occurredOn: string | null;
  occurredTime: string | null;
  occurredTimezone: string | null;
  media: readonly Readonly<{
    key: string;
    kind: "photo" | "video";
    name: string;
    mimeType: string;
    size: number;
  }>[];
  verse: Readonly<{
    book: string | null;
    chapter: number | null;
    startVerse: number | null;
    endVerse: number | null;
  }> | null;
  createdAt: string;
  updatedAt: string;
}>;

export type LocalJournalDocument = Readonly<{
  version: 1;
  circle: Readonly<{
    id: string;
    name: string;
    timeZone: string;
  }>;
  extraCircles?: readonly LocalExtraCircle[];
  people: readonly LocalPerson[];
  memberships: readonly LocalMembership[];
  accounts: readonly LocalAccount[];
  guardians: readonly LocalGuardian[];
  moments: readonly LocalMoment[];
  notes: readonly LocalNote[];
  reactions: readonly LocalReaction[];
  drafts?: readonly LocalEntryDraft[];
}>;
