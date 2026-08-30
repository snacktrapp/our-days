import { createHash } from "node:crypto";

export const FAMILY_EXPORT_FORMAT = "our-days-family-export" as const;
export const FAMILY_EXPORT_VERSION = 1 as const;

export type FamilyExportCircle = Readonly<{
  id: string;
  name: string;
  timeZone: string;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
}>;
export type FamilyExportPerson = Readonly<{
  id: string;
  circleId: string;
  displayName: string;
  profileKind: "account" | "managed";
  accentToken: "clay" | "sage" | "gold" | "sky" | "plum" | "rose";
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
}>;
/** Deliberately excludes the backing Auth user identity. */
export type FamilyExportMembership = Readonly<{
  id: string;
  circleId: string;
  personId: string;
  role: "member" | "organizer";
  status: "active" | "revoked";
  joinedAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedByMembershipId: string | null;
}>;
export type FamilyExportGuardian = Readonly<{
  id: string;
  circleId: string;
  managedPersonId: string;
  guardianMembershipId: string;
  createdByMembershipId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByMembershipId: string | null;
}>;
export type FamilyExportMoment = Readonly<{
  id: string;
  circleId: string;
  journalPersonId: string;
  recordedByMembershipId: string;
  kind: "thought" | "milestone" | "location";
  title: string | null;
  body: string;
  placeName: string | null;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  timePrecision: "date" | "minute";
  revision: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  trashedByMembershipId: string | null;
}>;
export type FamilyExportMomentPerson = Readonly<{
  circleId: string;
  momentId: string;
  personId: string;
  taggedByMembershipId: string;
  createdAt: string;
  removedAt: string | null;
}>;
export type FamilyExportNote = Readonly<{
  id: string;
  circleId: string;
  momentId: string;
  authorMembershipId: string;
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}>;
export type FamilyExportReaction = Readonly<{
  id: string;
  circleId: string;
  momentId: string;
  authorMembershipId: string;
  reactionType: "held-close" | "made-me-smile" | "remember-this";
  revision: number;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
}>;

export type FamilyExportRecords = Readonly<{
  circle: FamilyExportCircle;
  people: readonly FamilyExportPerson[];
  memberships: readonly FamilyExportMembership[];
  guardians: readonly FamilyExportGuardian[];
  moments: readonly FamilyExportMoment[];
  momentPeople: readonly FamilyExportMomentPerson[];
  notes: readonly FamilyExportNote[];
  reactions: readonly FamilyExportReaction[];
}>;
export type FamilyExportRecordCounts = Readonly<{
  people: number;
  memberships: number;
  guardians: number;
  moments: number;
  momentPeople: number;
  notes: number;
  reactions: number;
}>;
/** Independently produced by the source transaction, so an omitting loader cannot bless its own incomplete result. */
export type FamilyExportSourceSelection = Readonly<{
  version: 1;
  selectionId: string;
  expectedRecordCounts: FamilyExportRecordCounts;
  expectedRecordsSha256: string;
}>;
export type FamilyExportSnapshot = Readonly<
  FamilyExportRecords & {
    snapshotAt: string;
    sourceSelection: FamilyExportSourceSelection;
  }
>;
export type FamilyExportCounts = Readonly<
  FamilyExportRecordCounts & { mediaOriginals: 0; archiveFiles: 2 }
>;
export type FamilyExportFileDescriptor = Readonly<{
  path: "data/family-records.json";
  byteLength: number;
  sha256: string;
}>;
export type FamilyExportLifecycleScope = Readonly<{
  version: 1;
  selectionAuthority: "source-adapter";
  retentionPolicy: "unspecified";
  memberships: Readonly<{ active: number; revoked: number }>;
  guardians: Readonly<{ active: number; revoked: number }>;
  moments: Readonly<{ live: number; trashed: number }>;
  momentPeople: Readonly<{ live: number; removed: number }>;
  notes: Readonly<{ live: number; trashed: number }>;
  reactions: Readonly<{ live: number; removed: number }>;
}>;
export type FamilyExportManifest = Readonly<{
  format: typeof FAMILY_EXPORT_FORMAT;
  version: typeof FAMILY_EXPORT_VERSION;
  exportId: string;
  circleId: string;
  requesterMembershipId: string;
  snapshotAt: string;
  createdAt: string;
  snapshotSha256: string;
  sourceSelection: FamilyExportSourceSelection;
  lifecycleScope: FamilyExportLifecycleScope;
  media: Readonly<{ version: 1; originals: readonly [] }>;
  inventory: Readonly<{
    counts: FamilyExportCounts;
    recordsFile: FamilyExportFileDescriptor;
  }>;
}>;
export type FamilyArchiveBuild = Readonly<{
  manifest: FamilyExportManifest;
  files: ReadonlyMap<string, Uint8Array>;
}>;

export class FamilyExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FamilyExportValidationError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const allowedPaths = new Set(["manifest.json", "data/family-records.json"]);
const recordKeys = [
  "circle",
  "people",
  "memberships",
  "guardians",
  "moments",
  "momentPeople",
  "notes",
  "reactions",
] as const;
const countKeys = [
  "people",
  "memberships",
  "guardians",
  "moments",
  "momentPeople",
  "notes",
  "reactions",
] as const;

function fail(message: string): never {
  throw new FamilyExportValidationError(message);
}
function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) fail(`${label} must be an object.`);
  return value;
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    fail(`${label} has an unsupported or missing field.`);
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  return value;
}
function nullableString(value: unknown, label: string): string | null {
  if (value !== null && typeof value !== "string")
    fail(`${label} must be a string or null.`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    fail(`${label} must be an integer of at least ${minimum}.`);
  return value as number;
}
function uuid(value: unknown, label: string): string {
  const text = string(value, label);
  if (!uuidPattern.test(text)) fail(`${label} must be a UUID.`);
  return text;
}
function digest(value: unknown, label: string): string {
  const text = string(value, label);
  if (!sha256Pattern.test(text)) fail(`${label} must be a SHA-256 digest.`);
  return text;
}
function timestamp(value: unknown, label: string, snapshotAt?: string): string {
  const text = string(value, label);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== text)
    fail(`${label} must be a canonical UTC timestamp.`);
  if (snapshotAt && text > snapshotAt)
    fail(`${label} cannot be after the canonical snapshot time.`);
  return text;
}
function optionalTimestamp(
  value: unknown,
  label: string,
  snapshotAt: string,
): string | null {
  return value === null ? null : timestamp(value, label, snapshotAt);
}
function order(first: string, second: string, label: string) {
  if (first > second) fail(`${label} has timestamps out of order.`);
}
function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    fail(`${label} has an unsupported value.`);
  return value as T;
}
function safePath(path: string) {
  if (
    !allowedPaths.has(path) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  )
    fail("An archive path is unsafe or outside the versioned allowlist.");
}

function noForbiddenKeys(value: unknown, location = "archive") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      noForbiddenKeys(item, `${location}[${index}]`),
    );
    return;
  }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key
      .replaceAll("_", "")
      .replaceAll("-", "")
      .toLowerCase();
    if (
      normalized.includes("email") ||
      normalized.includes("session") ||
      normalized === "userid" ||
      (normalized.includes("auth") && normalized.includes("user")) ||
      (normalized.includes("token") && normalized !== "accenttoken")
    )
      fail(
        `Forbidden Auth, email, session, or token field at ${location}.${key}.`,
      );
    noForbiddenKeys(item, `${location}.${key}`);
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fail("Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.entries(value).sort(([a], [b]) =>
      ordinalCompare(a, b),
    );
    if (entries.some(([, item]) => item === undefined))
      fail("Canonical JSON cannot contain undefined values.");
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return fail("Canonical JSON contains an unsupported value.");
}
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonical(value));
}
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function compareId(left: { id: string }, right: { id: string }) {
  return ordinalCompare(left.id, right.id);
}
export function normalizeFamilyExportRecords(
  input: FamilyExportRecords,
): FamilyExportRecords {
  return {
    circle: { ...input.circle },
    people: [...input.people].sort(compareId).map((row) => ({ ...row })),
    memberships: [...input.memberships]
      .sort(compareId)
      .map((row) => ({ ...row })),
    guardians: [...input.guardians].sort(compareId).map((row) => ({ ...row })),
    moments: [...input.moments].sort(compareId).map((row) => ({ ...row })),
    momentPeople: [...input.momentPeople]
      .sort((a, b) =>
        ordinalCompare(
          `${a.momentId}\0${a.personId}`,
          `${b.momentId}\0${b.personId}`,
        ),
      )
      .map((row) => ({ ...row })),
    notes: [...input.notes].sort(compareId).map((row) => ({ ...row })),
    reactions: [...input.reactions].sort(compareId).map((row) => ({ ...row })),
  };
}
export function countFamilyExportRecords(
  records: FamilyExportRecords,
): FamilyExportRecordCounts {
  return {
    people: records.people.length,
    memberships: records.memberships.length,
    guardians: records.guardians.length,
    moments: records.moments.length,
    momentPeople: records.momentPeople.length,
    notes: records.notes.length,
    reactions: records.reactions.length,
  };
}
export function computeFamilyRecordsSha256(
  records: FamilyExportRecords,
): string {
  return sha256Hex(canonicalJsonBytes(normalizeFamilyExportRecords(records)));
}
function unique(values: readonly string[], label: string): ReadonlySet<string> {
  const set = new Set(values);
  if (set.size !== values.length)
    fail(`${label} contains duplicate identities.`);
  return set;
}
function circleRows(
  rows: readonly Record<string, unknown>[],
  circleId: string,
  label: string,
) {
  if (rows.some((row) => row.circleId !== circleId))
    fail(`${label} contains a row from another circle.`);
}
function counts(value: unknown, label: string): FamilyExportRecordCounts {
  const row = object(value, label);
  exact(row, countKeys, label);
  return Object.fromEntries(
    countKeys.map((key) => [key, integer(row[key], `${label}.${key}`)]),
  ) as FamilyExportRecordCounts;
}
function sourceSelection(value: unknown): FamilyExportSourceSelection {
  const row = object(value, "Source selection");
  exact(
    row,
    ["version", "selectionId", "expectedRecordCounts", "expectedRecordsSha256"],
    "Source selection",
  );
  if (row.version !== 1) fail("Source selection has an unsupported version.");
  return {
    version: 1,
    selectionId: digest(row.selectionId, "Source selection ID"),
    expectedRecordCounts: counts(
      row.expectedRecordCounts,
      "Source expected counts",
    ),
    expectedRecordsSha256: digest(
      row.expectedRecordsSha256,
      "Source expected records digest",
    ),
  };
}

function parseRecords(value: unknown, snapshotAt: string): FamilyExportRecords {
  noForbiddenKeys(value, "records");
  const root = object(value, "Records");
  exact(root, recordKeys, "Records");
  const c = object(root.circle, "Circle");
  exact(
    c,
    [
      "id",
      "name",
      "timeZone",
      "createdByMembershipId",
      "createdAt",
      "updatedAt",
    ],
    "Circle",
  );
  const circle: FamilyExportCircle = {
    id: uuid(c.id, "Circle ID"),
    name: string(c.name, "Circle name"),
    timeZone: string(c.timeZone, "Circle time zone"),
    createdByMembershipId: uuid(
      c.createdByMembershipId,
      "Circle creator membership ID",
    ),
    createdAt: timestamp(c.createdAt, "Circle creation time", snapshotAt),
    updatedAt: timestamp(c.updatedAt, "Circle update time", snapshotAt),
  };
  order(circle.createdAt, circle.updatedAt, "Circle");
  const people = array(root.people, "People").map(
    (value, i): FamilyExportPerson => {
      const r = object(value, `Person ${i}`);
      exact(
        r,
        [
          "id",
          "circleId",
          "displayName",
          "profileKind",
          "accentToken",
          "createdByMembershipId",
          "createdAt",
          "updatedAt",
        ],
        `Person ${i}`,
      );
      const p = {
        id: uuid(r.id, "Person ID"),
        circleId: uuid(r.circleId, "Person circle ID"),
        displayName: string(r.displayName, "Person display name"),
        profileKind: enumeration(
          r.profileKind,
          ["account", "managed"] as const,
          "Person profile kind",
        ),
        accentToken: enumeration(
          r.accentToken,
          ["clay", "sage", "gold", "sky", "plum", "rose"] as const,
          "Person accent token",
        ),
        createdByMembershipId: uuid(
          r.createdByMembershipId,
          "Person creator membership ID",
        ),
        createdAt: timestamp(r.createdAt, "Person creation time", snapshotAt),
        updatedAt: timestamp(r.updatedAt, "Person update time", snapshotAt),
      };
      order(p.createdAt, p.updatedAt, "Person");
      return p;
    },
  );
  const memberships = array(root.memberships, "Memberships").map(
    (value, i): FamilyExportMembership => {
      const r = object(value, `Membership ${i}`);
      exact(
        r,
        [
          "id",
          "circleId",
          "personId",
          "role",
          "status",
          "joinedAt",
          "updatedAt",
          "revokedAt",
          "revokedByMembershipId",
        ],
        `Membership ${i}`,
      );
      const p = {
        id: uuid(r.id, "Membership ID"),
        circleId: uuid(r.circleId, "Membership circle ID"),
        personId: uuid(r.personId, "Membership person ID"),
        role: enumeration(
          r.role,
          ["member", "organizer"] as const,
          "Membership role",
        ),
        status: enumeration(
          r.status,
          ["active", "revoked"] as const,
          "Membership status",
        ),
        joinedAt: timestamp(r.joinedAt, "Membership join time", snapshotAt),
        updatedAt: timestamp(r.updatedAt, "Membership update time", snapshotAt),
        revokedAt: optionalTimestamp(
          r.revokedAt,
          "Membership revocation time",
          snapshotAt,
        ),
        revokedByMembershipId:
          r.revokedByMembershipId === null
            ? null
            : uuid(r.revokedByMembershipId, "Revoking membership ID"),
      };
      order(p.joinedAt, p.updatedAt, "Membership");
      if (p.revokedAt) order(p.joinedAt, p.revokedAt, "Membership revocation");
      const active = p.revokedAt === null && p.revokedByMembershipId === null;
      const revoked = p.revokedAt !== null && p.revokedByMembershipId !== null;
      if (
        (p.status === "active" && !active) ||
        (p.status === "revoked" && !revoked)
      )
        fail("A membership has an inconsistent revocation state.");
      return p;
    },
  );
  const guardians = array(root.guardians, "Guardians").map(
    (value, i): FamilyExportGuardian => {
      const r = object(value, `Guardian ${i}`);
      exact(
        r,
        [
          "id",
          "circleId",
          "managedPersonId",
          "guardianMembershipId",
          "createdByMembershipId",
          "createdAt",
          "revokedAt",
          "revokedByMembershipId",
        ],
        `Guardian ${i}`,
      );
      const p = {
        id: uuid(r.id, "Guardian ID"),
        circleId: uuid(r.circleId, "Guardian circle ID"),
        managedPersonId: uuid(r.managedPersonId, "Managed person ID"),
        guardianMembershipId: uuid(
          r.guardianMembershipId,
          "Guardian membership ID",
        ),
        createdByMembershipId: uuid(
          r.createdByMembershipId,
          "Guardian creator membership ID",
        ),
        createdAt: timestamp(r.createdAt, "Guardian creation time", snapshotAt),
        revokedAt: optionalTimestamp(
          r.revokedAt,
          "Guardian revocation time",
          snapshotAt,
        ),
        revokedByMembershipId:
          r.revokedByMembershipId === null
            ? null
            : uuid(r.revokedByMembershipId, "Guardian revoking membership ID"),
      };
      if ((p.revokedAt === null) !== (p.revokedByMembershipId === null))
        fail("A guardian has an inconsistent revocation state.");
      if (p.revokedAt) order(p.createdAt, p.revokedAt, "Guardian revocation");
      return p;
    },
  );
  const moments = array(root.moments, "Moments").map(
    (value, i): FamilyExportMoment => {
      const r = object(value, `Moment ${i}`);
      exact(
        r,
        [
          "id",
          "circleId",
          "journalPersonId",
          "recordedByMembershipId",
          "kind",
          "title",
          "body",
          "placeName",
          "occurredOn",
          "occurredAt",
          "occurredTimezone",
          "timePrecision",
          "revision",
          "createdAt",
          "updatedAt",
          "trashedAt",
          "trashedByMembershipId",
        ],
        `Moment ${i}`,
      );
      const occurredOn = string(r.occurredOn, "Moment occurrence date");
      const date = new Date(`${occurredOn}T00:00:00.000Z`);
      if (
        !datePattern.test(occurredOn) ||
        !Number.isFinite(date.valueOf()) ||
        date.toISOString().slice(0, 10) !== occurredOn
      )
        fail("Moment occurrence date is invalid.");
      const p = {
        id: uuid(r.id, "Moment ID"),
        circleId: uuid(r.circleId, "Moment circle ID"),
        journalPersonId: uuid(r.journalPersonId, "Moment journal person ID"),
        recordedByMembershipId: uuid(
          r.recordedByMembershipId,
          "Moment recorder membership ID",
        ),
        kind: enumeration(
          r.kind,
          ["thought", "milestone", "location"] as const,
          "Moment kind",
        ),
        title: nullableString(r.title, "Moment title"),
        body: string(r.body, "Moment body"),
        placeName: nullableString(r.placeName, "Moment place name"),
        occurredOn,
        occurredAt: optionalTimestamp(
          r.occurredAt,
          "Moment occurrence time",
          snapshotAt,
        ),
        occurredTimezone: nullableString(
          r.occurredTimezone,
          "Moment occurrence time zone",
        ),
        timePrecision: enumeration(
          r.timePrecision,
          ["date", "minute"] as const,
          "Moment time precision",
        ),
        revision: integer(r.revision, "Moment revision", 1),
        createdAt: timestamp(r.createdAt, "Moment creation time", snapshotAt),
        updatedAt: timestamp(r.updatedAt, "Moment update time", snapshotAt),
        trashedAt: optionalTimestamp(
          r.trashedAt,
          "Moment trash time",
          snapshotAt,
        ),
        trashedByMembershipId:
          r.trashedByMembershipId === null
            ? null
            : uuid(r.trashedByMembershipId, "Moment trash membership ID"),
      };
      order(p.createdAt, p.updatedAt, "Moment");
      if (p.trashedAt) order(p.createdAt, p.trashedAt, "Moment trash");
      if ((p.trashedAt === null) !== (p.trashedByMembershipId === null))
        fail("A moment has an inconsistent trash state.");
      if (
        (p.timePrecision === "date" &&
          (p.occurredAt !== null || p.occurredTimezone !== null)) ||
        (p.timePrecision === "minute" &&
          (p.occurredAt === null || p.occurredTimezone === null))
      )
        fail("A moment has an inconsistent occurrence precision.");
      return p;
    },
  );
  const momentPeople = array(root.momentPeople, "Moment people").map(
    (value, i): FamilyExportMomentPerson => {
      const r = object(value, `Moment person ${i}`);
      exact(
        r,
        [
          "circleId",
          "momentId",
          "personId",
          "taggedByMembershipId",
          "createdAt",
          "removedAt",
        ],
        `Moment person ${i}`,
      );
      const p = {
        circleId: uuid(r.circleId, "Moment-person circle ID"),
        momentId: uuid(r.momentId, "Tagged moment ID"),
        personId: uuid(r.personId, "Tagged person ID"),
        taggedByMembershipId: uuid(
          r.taggedByMembershipId,
          "Tagging membership ID",
        ),
        createdAt: timestamp(
          r.createdAt,
          "Moment-person creation time",
          snapshotAt,
        ),
        removedAt: optionalTimestamp(
          r.removedAt,
          "Moment-person removal time",
          snapshotAt,
        ),
      };
      if (p.removedAt) order(p.createdAt, p.removedAt, "Moment-person removal");
      return p;
    },
  );
  const notes = array(root.notes, "Notes").map((value, i): FamilyExportNote => {
    const r = object(value, `Note ${i}`);
    exact(
      r,
      [
        "id",
        "circleId",
        "momentId",
        "authorMembershipId",
        "body",
        "revision",
        "createdAt",
        "updatedAt",
        "trashedAt",
      ],
      `Note ${i}`,
    );
    const p = {
      id: uuid(r.id, "Note ID"),
      circleId: uuid(r.circleId, "Note circle ID"),
      momentId: uuid(r.momentId, "Note moment ID"),
      authorMembershipId: uuid(
        r.authorMembershipId,
        "Note author membership ID",
      ),
      body: string(r.body, "Note body"),
      revision: integer(r.revision, "Note revision", 1),
      createdAt: timestamp(r.createdAt, "Note creation time", snapshotAt),
      updatedAt: timestamp(r.updatedAt, "Note update time", snapshotAt),
      trashedAt: optionalTimestamp(r.trashedAt, "Note trash time", snapshotAt),
    };
    order(p.createdAt, p.updatedAt, "Note");
    if (p.trashedAt) order(p.createdAt, p.trashedAt, "Note trash");
    return p;
  });
  const reactions = array(root.reactions, "Reactions").map(
    (value, i): FamilyExportReaction => {
      const r = object(value, `Reaction ${i}`);
      exact(
        r,
        [
          "id",
          "circleId",
          "momentId",
          "authorMembershipId",
          "reactionType",
          "revision",
          "createdAt",
          "updatedAt",
          "removedAt",
        ],
        `Reaction ${i}`,
      );
      const p = {
        id: uuid(r.id, "Reaction ID"),
        circleId: uuid(r.circleId, "Reaction circle ID"),
        momentId: uuid(r.momentId, "Reaction moment ID"),
        authorMembershipId: uuid(
          r.authorMembershipId,
          "Reaction author membership ID",
        ),
        reactionType: enumeration(
          r.reactionType,
          ["held-close", "made-me-smile", "remember-this"] as const,
          "Reaction type",
        ),
        revision: integer(r.revision, "Reaction revision", 1),
        createdAt: timestamp(r.createdAt, "Reaction creation time", snapshotAt),
        updatedAt: timestamp(r.updatedAt, "Reaction update time", snapshotAt),
        removedAt: optionalTimestamp(
          r.removedAt,
          "Reaction removal time",
          snapshotAt,
        ),
      };
      order(p.createdAt, p.updatedAt, "Reaction");
      if (p.removedAt) order(p.createdAt, p.removedAt, "Reaction removal");
      return p;
    },
  );
  const records = {
    circle,
    people,
    memberships,
    guardians,
    moments,
    momentPeople,
    notes,
    reactions,
  };
  validateRelations(records);
  return records;
}

function validateRelations(records: FamilyExportRecords) {
  const circleId = records.circle.id;
  const collections: readonly [readonly Record<string, unknown>[], string][] = [
    [records.people, "People"],
    [records.memberships, "Memberships"],
    [records.guardians, "Guardians"],
    [records.moments, "Moments"],
    [records.momentPeople, "Moment people"],
    [records.notes, "Notes"],
    [records.reactions, "Reactions"],
  ];
  collections.forEach(([rows, label]) => circleRows(rows, circleId, label));
  const people = unique(
    records.people.map((row) => row.id),
    "People",
  );
  const memberships = unique(
    records.memberships.map((row) => row.id),
    "Memberships",
  );
  unique(
    records.memberships.map((row) => row.personId),
    "Membership people",
  );
  unique(
    records.guardians.map((row) => row.id),
    "Guardians",
  );
  const moments = unique(
    records.moments.map((row) => row.id),
    "Moments",
  );
  unique(
    records.notes.map((row) => row.id),
    "Notes",
  );
  unique(
    records.reactions.map((row) => row.id),
    "Reactions",
  );
  unique(
    records.momentPeople.map((row) => `${row.momentId}\0${row.personId}`),
    "Moment people",
  );
  if (!memberships.has(records.circle.createdByMembershipId))
    fail("The circle creator membership is missing from the export.");
  records.people.forEach((row) => {
    if (!memberships.has(row.createdByMembershipId))
      fail("A person references a missing creator membership.");
  });
  records.memberships.forEach((row) => {
    if (!people.has(row.personId))
      fail("A membership references a missing person.");
    if (
      row.revokedByMembershipId &&
      !memberships.has(row.revokedByMembershipId)
    )
      fail("A membership references a missing revoking membership.");
  });
  records.guardians.forEach((row) => {
    if (
      records.people.find((person) => person.id === row.managedPersonId)
        ?.profileKind !== "managed"
    )
      fail("A guardian must reference a managed person.");
    for (const id of [
      row.guardianMembershipId,
      row.createdByMembershipId,
      row.revokedByMembershipId,
    ].filter(Boolean) as string[])
      if (!memberships.has(id))
        fail("A guardian references a missing membership.");
  });
  records.moments.forEach((row) => {
    if (!people.has(row.journalPersonId))
      fail("A moment references a missing journal person.");
    for (const id of [
      row.recordedByMembershipId,
      row.trashedByMembershipId,
    ].filter(Boolean) as string[])
      if (!memberships.has(id))
        fail("A moment references a missing attribution membership.");
  });
  records.momentPeople.forEach((row) => {
    if (
      !moments.has(row.momentId) ||
      !people.has(row.personId) ||
      !memberships.has(row.taggedByMembershipId)
    )
      fail("A moment-person row references a missing record.");
  });
  records.notes.forEach((row) => {
    if (!moments.has(row.momentId) || !memberships.has(row.authorMembershipId))
      fail("A note references a missing record.");
  });
  records.reactions.forEach((row) => {
    if (!moments.has(row.momentId) || !memberships.has(row.authorMembershipId))
      fail("A reaction references a missing record.");
  });
}

function equalCounts(
  actual: FamilyExportRecordCounts,
  expected: FamilyExportRecordCounts,
  label: string,
) {
  const selectedExpected = Object.fromEntries(
    countKeys.map((key) => [key, expected[key]]),
  );
  if (canonical(actual) !== canonical(selectedExpected))
    fail(`${label} do not match the records.`);
}
function validatedSnapshot(
  snapshot: FamilyExportSnapshot,
): FamilyExportRecords {
  const root = object(snapshot, "Snapshot");
  exact(root, ["snapshotAt", "sourceSelection", ...recordKeys], "Snapshot");
  const at = timestamp(root.snapshotAt, "Snapshot time");
  const records = parseRecords(
    Object.fromEntries(recordKeys.map((key) => [key, root[key]])),
    at,
  );
  const selection = sourceSelection(root.sourceSelection);
  equalCounts(
    countFamilyExportRecords(records),
    selection.expectedRecordCounts,
    "Source expected counts",
  );
  if (computeFamilyRecordsSha256(records) !== selection.expectedRecordsSha256)
    fail("Source expected records digest does not match the records.");
  return normalizeFamilyExportRecords(records);
}
export function computeFamilySnapshotSha256(
  snapshot: FamilyExportSnapshot,
): string {
  const records = validatedSnapshot(snapshot);
  return sha256Hex(
    canonicalJsonBytes({ records, sourceSelection: snapshot.sourceSelection }),
  );
}

function lifecycle(records: FamilyExportRecords): FamilyExportLifecycleScope {
  const n = <T>(rows: readonly T[], predicate: (row: T) => boolean) =>
    rows.filter(predicate).length;
  return {
    version: 1,
    selectionAuthority: "source-adapter",
    retentionPolicy: "unspecified",
    memberships: {
      active: n(records.memberships, (row) => row.status === "active"),
      revoked: n(records.memberships, (row) => row.status === "revoked"),
    },
    guardians: {
      active: n(records.guardians, (row) => row.revokedAt === null),
      revoked: n(records.guardians, (row) => row.revokedAt !== null),
    },
    moments: {
      live: n(records.moments, (row) => row.trashedAt === null),
      trashed: n(records.moments, (row) => row.trashedAt !== null),
    },
    momentPeople: {
      live: n(records.momentPeople, (row) => row.removedAt === null),
      removed: n(records.momentPeople, (row) => row.removedAt !== null),
    },
    notes: {
      live: n(records.notes, (row) => row.trashedAt === null),
      trashed: n(records.notes, (row) => row.trashedAt !== null),
    },
    reactions: {
      live: n(records.reactions, (row) => row.removedAt === null),
      removed: n(records.reactions, (row) => row.removedAt !== null),
    },
  };
}

export function buildFamilyArchive(
  input: Readonly<{
    exportId: string;
    requesterMembershipId: string;
    snapshotAt: string;
    createdAt: string;
    snapshotSha256: string;
    snapshot: FamilyExportSnapshot;
  }>,
): FamilyArchiveBuild {
  uuid(input.exportId, "Export ID");
  uuid(input.requesterMembershipId, "Requester membership ID");
  timestamp(input.snapshotAt, "Snapshot time");
  timestamp(input.createdAt, "Creation time");
  digest(input.snapshotSha256, "Snapshot digest");
  if (input.snapshot.snapshotAt !== input.snapshotAt)
    fail("The source snapshot does not match the immutable request time.");
  if (computeFamilySnapshotSha256(input.snapshot) !== input.snapshotSha256)
    fail("The source snapshot does not match the immutable snapshot digest.");
  const records = normalizeFamilyExportRecords(input.snapshot);
  const requester = records.memberships.find(
    (row) => row.id === input.requesterMembershipId,
  );
  if (
    !requester ||
    requester.status !== "active" ||
    requester.role !== "organizer"
  )
    fail("The export requester is not an active organizer in the snapshot.");
  const recordsBytes = canonicalJsonBytes(records);
  const recordCounts = countFamilyExportRecords(records);
  const manifest: FamilyExportManifest = {
    format: FAMILY_EXPORT_FORMAT,
    version: FAMILY_EXPORT_VERSION,
    exportId: input.exportId,
    circleId: records.circle.id,
    requesterMembershipId: input.requesterMembershipId,
    snapshotAt: input.snapshotAt,
    createdAt: input.createdAt,
    snapshotSha256: input.snapshotSha256,
    sourceSelection: {
      ...input.snapshot.sourceSelection,
      expectedRecordCounts: {
        ...input.snapshot.sourceSelection.expectedRecordCounts,
      },
    },
    lifecycleScope: lifecycle(records),
    media: { version: 1, originals: [] },
    inventory: {
      counts: { ...recordCounts, mediaOriginals: 0, archiveFiles: 2 },
      recordsFile: {
        path: "data/family-records.json",
        byteLength: recordsBytes.byteLength,
        sha256: sha256Hex(recordsBytes),
      },
    },
  };
  const files = new Map<string, Uint8Array>([
    ["data/family-records.json", recordsBytes],
    ["manifest.json", canonicalJsonBytes(manifest)],
  ]);
  const result = { manifest, files } as const;
  validateFamilyArchive(result);
  return result;
}

function decode(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(`${label} is not valid UTF-8.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(`${label} is not valid JSON.`);
  }
  if (!bytesEqual(bytes, canonicalJsonBytes(parsed)))
    fail(`${label} is not canonical JSON.`);
  return parsed;
}
function pair(
  value: unknown,
  keys: readonly [string, string],
  label: string,
): Record<string, number> {
  const row = object(value, label);
  exact(row, keys, label);
  return {
    [keys[0]]: integer(row[keys[0]], `${label}.${keys[0]}`),
    [keys[1]]: integer(row[keys[1]], `${label}.${keys[1]}`),
  };
}
function parseManifest(value: unknown): FamilyExportManifest {
  noForbiddenKeys(value, "manifest");
  const root = object(value, "Manifest");
  exact(
    root,
    [
      "format",
      "version",
      "exportId",
      "circleId",
      "requesterMembershipId",
      "snapshotAt",
      "createdAt",
      "snapshotSha256",
      "sourceSelection",
      "lifecycleScope",
      "media",
      "inventory",
    ],
    "Manifest",
  );
  if (
    root.format !== FAMILY_EXPORT_FORMAT ||
    root.version !== FAMILY_EXPORT_VERSION
  )
    fail("Manifest format or version is unsupported.");
  const scope = object(root.lifecycleScope, "Lifecycle scope");
  exact(
    scope,
    [
      "version",
      "selectionAuthority",
      "retentionPolicy",
      "memberships",
      "guardians",
      "moments",
      "momentPeople",
      "notes",
      "reactions",
    ],
    "Lifecycle scope",
  );
  if (
    scope.version !== 1 ||
    scope.selectionAuthority !== "source-adapter" ||
    scope.retentionPolicy !== "unspecified"
  )
    fail("Lifecycle scope is unsupported.");
  const media = object(root.media, "Media inventory");
  exact(media, ["version", "originals"], "Media inventory");
  if (
    media.version !== 1 ||
    array(media.originals, "Media originals").length !== 0
  )
    fail("Media originals must be empty in export format v1.");
  const inventory = object(root.inventory, "Inventory");
  exact(inventory, ["counts", "recordsFile"], "Inventory");
  const countRow = object(inventory.counts, "Inventory counts");
  exact(
    countRow,
    [...countKeys, "mediaOriginals", "archiveFiles"],
    "Inventory counts",
  );
  if (countRow.mediaOriginals !== 0 || countRow.archiveFiles !== 2)
    fail("V1 inventory must contain two files and zero media originals.");
  const file = object(inventory.recordsFile, "Records file");
  exact(file, ["path", "byteLength", "sha256"], "Records file");
  const path = string(file.path, "Records file path");
  safePath(path);
  if (path !== "data/family-records.json")
    fail("Records file path is unsupported.");
  return {
    format: FAMILY_EXPORT_FORMAT,
    version: FAMILY_EXPORT_VERSION,
    exportId: uuid(root.exportId, "Export ID"),
    circleId: uuid(root.circleId, "Circle ID"),
    requesterMembershipId: uuid(
      root.requesterMembershipId,
      "Requester membership ID",
    ),
    snapshotAt: timestamp(root.snapshotAt, "Snapshot time"),
    createdAt: timestamp(root.createdAt, "Creation time"),
    snapshotSha256: digest(root.snapshotSha256, "Snapshot digest"),
    sourceSelection: sourceSelection(root.sourceSelection),
    lifecycleScope: {
      version: 1,
      selectionAuthority: "source-adapter",
      retentionPolicy: "unspecified",
      memberships: pair(
        scope.memberships,
        ["active", "revoked"],
        "Membership lifecycle",
      ) as { active: number; revoked: number },
      guardians: pair(
        scope.guardians,
        ["active", "revoked"],
        "Guardian lifecycle",
      ) as { active: number; revoked: number },
      moments: pair(scope.moments, ["live", "trashed"], "Moment lifecycle") as {
        live: number;
        trashed: number;
      },
      momentPeople: pair(
        scope.momentPeople,
        ["live", "removed"],
        "Moment-person lifecycle",
      ) as { live: number; removed: number },
      notes: pair(scope.notes, ["live", "trashed"], "Note lifecycle") as {
        live: number;
        trashed: number;
      },
      reactions: pair(
        scope.reactions,
        ["live", "removed"],
        "Reaction lifecycle",
      ) as { live: number; removed: number },
    },
    media: { version: 1, originals: [] },
    inventory: {
      counts: {
        ...counts(
          Object.fromEntries(countKeys.map((key) => [key, countRow[key]])),
          "Inventory counts",
        ),
        mediaOriginals: 0,
        archiveFiles: 2,
      },
      recordsFile: {
        path: "data/family-records.json",
        byteLength: integer(file.byteLength, "Records file byte length"),
        sha256: digest(file.sha256, "Records file checksum"),
      },
    },
  };
}

export function validateFamilyArchive(archive: FamilyArchiveBuild): void {
  if (!(archive.files instanceof Map)) fail("Archive files must be a map.");
  const paths = [...archive.files.keys()];
  paths.forEach(safePath);
  if (
    paths.length !== 2 ||
    !paths.includes("manifest.json") ||
    !paths.includes("data/family-records.json")
  )
    fail("Archive contains a missing, unlisted, or duplicate file.");
  const manifestBytes = archive.files.get("manifest.json");
  const recordsBytes = archive.files.get("data/family-records.json");
  if (!manifestBytes || !recordsBytes)
    fail("Archive is missing a required file.");
  const manifest = parseManifest(decode(manifestBytes, "Manifest file"));
  if (!bytesEqual(manifestBytes, canonicalJsonBytes(archive.manifest)))
    fail("The supplied manifest does not match manifest.json.");
  if (recordsBytes.byteLength !== manifest.inventory.recordsFile.byteLength)
    fail("Records file byte count does not match the manifest.");
  if (sha256Hex(recordsBytes) !== manifest.inventory.recordsFile.sha256)
    fail("Records file checksum does not match the manifest.");
  const records = parseRecords(
    decode(recordsBytes, "Records file"),
    manifest.snapshotAt,
  );
  const normalized = normalizeFamilyExportRecords(records);
  if (!bytesEqual(recordsBytes, canonicalJsonBytes(normalized)))
    fail("Records file is not in canonical normalized order.");
  if (records.circle.id !== manifest.circleId)
    fail("Records belong to another circle.");
  const requester = records.memberships.find(
    (row) => row.id === manifest.requesterMembershipId,
  );
  if (
    !requester ||
    requester.role !== "organizer" ||
    requester.status !== "active"
  )
    fail("The manifest requester is not an active organizer in the snapshot.");
  const recordCounts = countFamilyExportRecords(records);
  equalCounts(recordCounts, manifest.inventory.counts, "Inventory counts");
  equalCounts(
    recordCounts,
    manifest.sourceSelection.expectedRecordCounts,
    "Source expected counts",
  );
  if (
    computeFamilyRecordsSha256(records) !==
    manifest.sourceSelection.expectedRecordsSha256
  )
    fail("Source expected records digest does not match the records.");
  const snapshotDigest = sha256Hex(
    canonicalJsonBytes({
      records: normalized,
      sourceSelection: manifest.sourceSelection,
    }),
  );
  if (snapshotDigest !== manifest.snapshotSha256)
    fail(
      "Snapshot digest does not match the canonical records and selection metadata.",
    );
  if (canonical(lifecycle(records)) !== canonical(manifest.lifecycleScope))
    fail("Lifecycle scope does not match the supplied records.");
}
