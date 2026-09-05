import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  localAlexMembershipId,
  localAlexPersonId,
  localCaseyPersonId,
  localCircleId,
  localFamilyEmail,
  localJordanEmail,
  localJordanMembershipId,
  localJordanPersonId,
  localRileyPersonId,
} from "./ids";
import { canCreateInsight, hasOrganizerPrivilege } from "@/lib/circle-roles";
import type {
  LocalJournalDocument,
  LocalMedia,
  LocalMoment,
  LocalMomentKind,
  LocalNote,
  LocalReaction,
} from "./types";

const writtenKinds = new Set<LocalMomentKind>([
  "thought",
  "milestone",
  "location",
]);
const mediaKinds = new Set<LocalMomentKind>(["photo", "video"]);

let writeQueue: Promise<unknown> = Promise.resolve();

function dataRoot() {
  const configured = process.env.OUR_DAYS_LOCAL_JOURNAL_DIR;
  if (configured && configured.trim()) return resolve(configured.trim());
  return resolve(process.cwd(), ".data/our-days-local");
}

function documentPath() {
  return join(dataRoot(), "journal.json");
}

export function localJournalMediaDirectory() {
  return join(dataRoot(), "media");
}

function nowIso() {
  return new Date().toISOString();
}

function emptyDocument(): LocalJournalDocument {
  const createdAt = "2026-09-01T12:00:00.000Z";
  return {
    version: 1,
    circle: {
      id: localCircleId,
      name: "Our Days",
      timeZone: "America/Los_Angeles",
    },
    people: [
      {
        id: localAlexPersonId,
        displayName: "Alex",
        profileKind: "account",
        accentToken: "clay",
        createdAt,
      },
      {
        id: localJordanPersonId,
        displayName: "Jordan",
        profileKind: "account",
        accentToken: "gold",
        createdAt,
      },
      {
        id: localCaseyPersonId,
        displayName: "Casey",
        profileKind: "managed",
        accentToken: "sage",
        createdAt,
      },
      {
        id: localRileyPersonId,
        displayName: "Riley",
        profileKind: "managed",
        accentToken: "sky",
        createdAt,
      },
    ],
    memberships: [
      {
        id: localAlexMembershipId,
        personId: localAlexPersonId,
        role: "organizer",
        status: "active",
        joinedAt: createdAt,
      },
      {
        id: localJordanMembershipId,
        personId: localJordanPersonId,
        role: "member",
        status: "active",
        joinedAt: createdAt,
      },
    ],
    accounts: [
      {
        email: localFamilyEmail,
        personId: localAlexPersonId,
        membershipId: localAlexMembershipId,
      },
      {
        email: localJordanEmail,
        personId: localJordanPersonId,
        membershipId: localJordanMembershipId,
      },
    ],
    guardians: [
      {
        managedPersonId: localCaseyPersonId,
        guardianMembershipId: localAlexMembershipId,
      },
      {
        managedPersonId: localRileyPersonId,
        guardianMembershipId: localAlexMembershipId,
      },
    ],
    moments: [],
    notes: [],
    reactions: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDocument(value: unknown): LocalJournalDocument {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.circle)) {
    throw new Error("Local journal document is unreadable");
  }
  return value as LocalJournalDocument;
}

function readDocumentUnlocked(): LocalJournalDocument {
  try {
    return parseDocument(JSON.parse(readFileSync(documentPath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const document = emptyDocument();
      writeDocumentUnlocked(document);
      return document;
    }
    throw error;
  }
}

function writeDocumentUnlocked(document: LocalJournalDocument) {
  const path = documentPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(temporary, path);
}

async function withStoreLock<T>(work: () => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(work, work);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function sha256Hex(bytes: Uint8Array | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readLocalJournal() {
  return withStoreLock(() => readDocumentUnlocked());
}

export async function findLocalAccount(email: string) {
  const document = await readLocalJournal();
  return (
    document.accounts.find((account) => account.email === email) ?? undefined
  );
}

export type LocalAccess = Readonly<{
  membershipId: string;
  circleId: string;
  personId: string;
  role: string;
}>;

function requireMembership(
  document: LocalJournalDocument,
  access: LocalAccess,
) {
  if (access.circleId !== document.circle.id) {
    throw new Error("That family is not available.");
  }
  const membership = document.memberships.find(
    (candidate) =>
      candidate.id === access.membershipId &&
      candidate.personId === access.personId &&
      candidate.status === "active",
  );
  if (!membership) throw new Error("Family access is unavailable.");
  return membership;
}

function canWriteJournal(
  document: LocalJournalDocument,
  access: LocalAccess,
  journalPersonId: string | null,
) {
  if (!journalPersonId) return hasOrganizerPrivilege(access.role);
  if (journalPersonId === access.personId) return true;
  const person = document.people.find(
    (candidate) => candidate.id === journalPersonId,
  );
  if (!person || person.profileKind !== "managed") return false;
  if (hasOrganizerPrivilege(access.role)) return true;
  return document.guardians.some(
    (guardian) =>
      guardian.managedPersonId === journalPersonId &&
      guardian.guardianMembershipId === access.membershipId,
  );
}

function nextRevision(current: number) {
  return current + 1;
}

function resolvedAudience(
  access: LocalAccess,
  journalPersonId: string | null,
  audience?: "family" | "just_me",
) {
  if (audience !== "just_me") return "family" as const;
  if (journalPersonId !== access.personId) {
    throw new Error("Just Me moments can only live on your own journal.");
  }
  return "just_me" as const;
}

export async function createLocalWrittenMoment(
  access: LocalAccess,
  input: Readonly<{
    journalPersonId: string;
    kind: LocalMomentKind;
    title: string;
    body: string;
    placeName: string;
    latitude?: number | null;
    longitude?: number | null;
    taggedPersonIds: readonly string[];
    occurredOn: string;
    occurredAt: string | null;
    occurredTimezone: string | null;
    audience?: "family" | "just_me";
  }>,
) {
  return withStoreLock(() => {
    if (mediaKinds.has(input.kind)) {
      throw new Error(
        "Photo and video moments must use the verified media coordinators.",
      );
    }
    if (!writtenKinds.has(input.kind)) {
      throw new Error("That moment type is not available.");
    }
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    if (!canWriteJournal(document, access, input.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const createdAt = nowIso();
    const moment: LocalMoment = {
      id: randomUUID(),
      journalPersonId: input.journalPersonId,
      recordedByMembershipId: access.membershipId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      placeName: input.placeName,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      taggedPersonIds:
        input.audience === "just_me" ? [] : [...input.taggedPersonIds],
      occurredOn: input.occurredOn,
      occurredAt: input.occurredAt,
      occurredTimezone: input.occurredTimezone,
      audience: resolvedAudience(access, input.journalPersonId, input.audience),
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      trashedAt: null,
      trashedByMembershipId: null,
    };
    writeDocumentUnlocked({
      ...document,
      moments: [moment, ...document.moments],
    });
    return moment.id;
  });
}

export async function createLocalInsightMoment(
  access: LocalAccess,
  input: Readonly<{
    quote: string;
    attribution: string;
    sourceUrl?: string | null;
    occurredOn: string;
    occurredAt: string | null;
    occurredTimezone: string | null;
  }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    if (!canCreateInsight(access.role)) {
      throw new Error("Only an organizer or Operations can create an Insight.");
    }
    const createdAt = nowIso();
    const moment: LocalMoment = {
      id: randomUUID(),
      journalPersonId: null,
      recordedByMembershipId: access.membershipId,
      kind: "insight",
      title: input.attribution,
      body: input.quote,
      sourceUrl: input.sourceUrl ?? null,
      placeName: "",
      taggedPersonIds: [],
      occurredOn: input.occurredOn,
      occurredAt: input.occurredAt,
      occurredTimezone: input.occurredTimezone,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      trashedAt: null,
      trashedByMembershipId: null,
    };
    writeDocumentUnlocked({
      ...document,
      moments: [moment, ...document.moments],
    });
    return moment.id;
  });
}

export async function updateLocalWrittenMoment(
  access: LocalAccess,
  input: Readonly<{
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
    audience?: "family" | "just_me";
  }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.moments.find(
      (moment) => moment.id === input.momentId && moment.trashedAt === null,
    );
    if (!current) throw new Error("That moment could not be changed.");
    if (mediaKinds.has(current.kind) && (input.title || input.placeName)) {
      // Caption and date edits stay on the generic written path.
    }
    if (current.revision !== input.revision) {
      const error = new Error("revision conflict");
      (error as Error & { code?: string }).code = "40001";
      throw error;
    }
    if (!canWriteJournal(document, access, current.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const updated: LocalMoment = {
      ...current,
      title: input.title,
      body: input.body,
      placeName: input.placeName,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      taggedPersonIds:
        input.audience === "just_me" ? [] : [...input.taggedPersonIds],
      occurredOn: input.occurredOn,
      occurredAt: input.occurredAt,
      occurredTimezone: input.occurredTimezone,
      audience: resolvedAudience(
        access,
        current.journalPersonId,
        input.audience ?? current.audience,
      ),
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
    };
    writeDocumentUnlocked({
      ...document,
      moments: document.moments.map((moment) =>
        moment.id === current.id ? updated : moment,
      ),
    });
    return updated.revision;
  });
}

export async function setLocalMomentTrashed(
  access: LocalAccess,
  input: Readonly<{ momentId: string; revision: number; trashed: boolean }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.moments.find(
      (moment) => moment.id === input.momentId,
    );
    if (!current) throw new Error("That moment could not be changed.");
    if (current.revision !== input.revision) {
      const error = new Error("revision conflict");
      (error as Error & { code?: string }).code = "40001";
      throw error;
    }
    if (!canWriteJournal(document, access, current.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const updated: LocalMoment = {
      ...current,
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
      trashedAt: input.trashed ? nowIso() : null,
      trashedByMembershipId: input.trashed ? access.membershipId : null,
    };
    writeDocumentUnlocked({
      ...document,
      moments: document.moments.map((moment) =>
        moment.id === current.id ? updated : moment,
      ),
    });
    return updated.revision;
  });
}

export async function publishLocalMediaMoment(
  access: LocalAccess,
  input: Readonly<{
    kind: "photo" | "video";
    journalPersonId: string;
    body: string;
    placeName: string;
    latitude?: number | null;
    longitude?: number | null;
    taggedPersonIds: readonly string[];
    occurredOn: string;
    occurredAt: string | null;
    occurredTimezone: string | null;
    audience?: "family" | "just_me";
    media: LocalMedia;
  }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    if (!canWriteJournal(document, access, input.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const createdAt = nowIso();
    const photo =
      input.kind === "photo"
        ? { id: randomUUID(), ...input.media }
        : undefined;
    const moment: LocalMoment = {
      id: randomUUID(),
      journalPersonId: input.journalPersonId,
      recordedByMembershipId: access.membershipId,
      kind: input.kind,
      title: "",
      body: input.body,
      placeName: input.placeName,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      taggedPersonIds:
        input.audience === "just_me" ? [] : [...input.taggedPersonIds],
      occurredOn: input.occurredOn,
      occurredAt: input.occurredAt,
      occurredTimezone: input.occurredTimezone,
      audience: resolvedAudience(access, input.journalPersonId, input.audience),
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      trashedAt: null,
      trashedByMembershipId: null,
      media: input.media,
      photos: photo ? [photo] : undefined,
    };
    writeDocumentUnlocked({
      ...document,
      moments: [moment, ...document.moments],
    });
    return moment;
  });
}

export async function createLocalNote(
  access: LocalAccess,
  input: Readonly<{ momentId: string; body: string }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const moment = document.moments.find(
      (candidate) =>
        candidate.id === input.momentId && candidate.trashedAt === null,
    );
    if (!moment) throw new Error("That note could not be saved.");
    if (
      moment.audience === "just_me" &&
      moment.recordedByMembershipId !== access.membershipId
    ) {
      throw new Error("That note could not be saved.");
    }
    const createdAt = nowIso();
    const note: LocalNote = {
      id: randomUUID(),
      momentId: input.momentId,
      authorMembershipId: access.membershipId,
      body: input.body,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      trashedAt: null,
    };
    writeDocumentUnlocked({
      ...document,
      notes: [note, ...document.notes],
    });
    return note.id;
  });
}

export async function updateLocalNote(
  access: LocalAccess,
  input: Readonly<{ noteId: string; revision: number; body: string }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.notes.find(
      (note) =>
        note.id === input.noteId &&
        note.authorMembershipId === access.membershipId &&
        note.trashedAt === null,
    );
    if (!current) throw new Error("That note could not be changed.");
    if (current.revision !== input.revision) {
      const error = new Error("revision conflict");
      (error as Error & { code?: string }).code = "40001";
      throw error;
    }
    const updated: LocalNote = {
      ...current,
      body: input.body,
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
    };
    writeDocumentUnlocked({
      ...document,
      notes: document.notes.map((note) =>
        note.id === current.id ? updated : note,
      ),
    });
    return updated.revision;
  });
}

export async function trashLocalNote(
  access: LocalAccess,
  input: Readonly<{ noteId: string; revision: number }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.notes.find(
      (note) =>
        note.id === input.noteId &&
        note.authorMembershipId === access.membershipId,
    );
    if (!current) throw new Error("That note could not be changed.");
    if (current.revision !== input.revision) {
      const error = new Error("revision conflict");
      (error as Error & { code?: string }).code = "40001";
      throw error;
    }
    const updated: LocalNote = {
      ...current,
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
      trashedAt: nowIso(),
    };
    writeDocumentUnlocked({
      ...document,
      notes: document.notes.map((note) =>
        note.id === current.id ? updated : note,
      ),
    });
    return updated.revision;
  });
}

export async function setLocalReaction(
  access: LocalAccess,
  input: Readonly<{
    momentId: string;
    reactionId: "held-close" | "made-me-smile" | "remember-this" | null;
  }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const moment = document.moments.find(
      (candidate) =>
        candidate.id === input.momentId && candidate.trashedAt === null,
    );
    if (!moment) throw new Error("That response could not be saved.");
    if (
      moment.audience === "just_me" &&
      moment.recordedByMembershipId !== access.membershipId
    ) {
      throw new Error("That response could not be saved.");
    }
    const existing = document.reactions.find(
      (reaction) =>
        reaction.momentId === input.momentId &&
        reaction.authorMembershipId === access.membershipId &&
        reaction.removedAt === null,
    );
    const createdAt = nowIso();
    let reactions = document.reactions;
    if (existing) {
      reactions = reactions.map((reaction) =>
        reaction.id === existing.id
          ? { ...reaction, removedAt: createdAt }
          : reaction,
      );
    }
    if (input.reactionId) {
      const next: LocalReaction = {
        id: randomUUID(),
        momentId: input.momentId,
        authorMembershipId: access.membershipId,
        reactionType: input.reactionId,
        createdAt,
        removedAt: null,
      };
      reactions = [next, ...reactions];
    }
    writeDocumentUnlocked({ ...document, reactions });
    return 1;
  });
}

export function compareTimelineMoments(left: LocalMoment, right: LocalMoment) {
  if (left.occurredOn !== right.occurredOn) {
    return right.occurredOn.localeCompare(left.occurredOn);
  }
  if (Boolean(left.occurredAt) !== Boolean(right.occurredAt)) {
    return left.occurredAt ? -1 : 1;
  }
  if (
    left.occurredAt &&
    right.occurredAt &&
    left.occurredAt !== right.occurredAt
  ) {
    return right.occurredAt.localeCompare(left.occurredAt);
  }
  return right.id.localeCompare(left.id);
}

function localPhotosFor(moment: LocalMoment) {
  if (moment.photos && moment.photos.length > 0) return [...moment.photos];
  if (moment.kind === "photo" && moment.media) {
    return [{ id: moment.id, ...moment.media }];
  }
  return [];
}

function removeLocalPhotoFiles(photo: LocalMedia) {
  const mediaRoot = localJournalMediaDirectory();
  for (const relative of [
    photo.originalRelativePath,
    photo.displayRelativePath,
  ]) {
    if (!relative) continue;
    const directory = dirname(join(mediaRoot, relative));
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function attachLocalPhotoToMoment(
  access: LocalAccess,
  input: Readonly<{
    momentId: string;
    media: LocalMedia & { id: string };
  }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.moments.find(
      (moment) => moment.id === input.momentId && moment.trashedAt === null,
    );
    if (!current || current.kind !== "photo") {
      throw new Error("That photo could not be added.");
    }
    if (!canWriteJournal(document, access, current.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const photos = localPhotosFor(current);
    if (photos.length >= 6) {
      throw new Error("A photo entry can hold up to 6 photos.");
    }
    const nextPhotos = [...photos, input.media];
    const updated: LocalMoment = {
      ...current,
      photos: nextPhotos,
      media: nextPhotos[0],
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
    };
    writeDocumentUnlocked({
      ...document,
      moments: document.moments.map((moment) =>
        moment.id === current.id ? updated : moment,
      ),
    });
    return updated;
  });
}

export async function reorderLocalMomentPhotos(
  access: LocalAccess,
  input: Readonly<{ momentId: string; photoIds: readonly string[] }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.moments.find(
      (moment) => moment.id === input.momentId && moment.trashedAt === null,
    );
    if (!current || current.kind !== "photo") {
      throw new Error("Those photos could not be reordered.");
    }
    if (!canWriteJournal(document, access, current.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const photos = localPhotosFor(current);
    if (
      input.photoIds.length !== photos.length ||
      new Set(input.photoIds).size !== photos.length ||
      input.photoIds.some((id) => !photos.some((photo) => photo.id === id))
    ) {
      throw new Error("Those photos could not be reordered.");
    }
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const nextPhotos = input.photoIds.map((id) => byId.get(id)!);
    const updated: LocalMoment = {
      ...current,
      photos: nextPhotos,
      media: nextPhotos[0],
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
    };
    writeDocumentUnlocked({
      ...document,
      moments: document.moments.map((moment) =>
        moment.id === current.id ? updated : moment,
      ),
    });
    return updated.revision;
  });
}

export async function removeLocalMomentPhoto(
  access: LocalAccess,
  input: Readonly<{ momentId: string; photoId: string }>,
) {
  return withStoreLock(() => {
    const document = readDocumentUnlocked();
    requireMembership(document, access);
    const current = document.moments.find(
      (moment) => moment.id === input.momentId && moment.trashedAt === null,
    );
    if (!current || current.kind !== "photo") {
      throw new Error("That photo could not be removed.");
    }
    if (!canWriteJournal(document, access, current.journalPersonId)) {
      throw new Error("That journal cannot be written from this account.");
    }
    const photos = localPhotosFor(current);
    if (photos.length <= 1) {
      throw new Error("Keep at least one photo, or move the moment to trash.");
    }
    const removed = photos.find((photo) => photo.id === input.photoId);
    if (!removed) throw new Error("That photo could not be removed.");
    const nextPhotos = photos.filter((photo) => photo.id !== input.photoId);
    removeLocalPhotoFiles(removed);
    const updated: LocalMoment = {
      ...current,
      photos: nextPhotos,
      media: nextPhotos[0],
      revision: nextRevision(current.revision),
      updatedAt: nowIso(),
    };
    writeDocumentUnlocked({
      ...document,
      moments: document.moments.map((moment) =>
        moment.id === current.id ? updated : moment,
      ),
    });
    return updated.revision;
  });
}

export function resetLocalJournalForTests() {
  rmSync(dataRoot(), { recursive: true, force: true });
}
