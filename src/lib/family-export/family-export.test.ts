import { describe, expect, it } from "vitest";
import {
  buildFamilyArchive,
  bytesEqual,
  canonicalJsonBytes,
  computeFamilyRecordsSha256,
  computeFamilySnapshotSha256,
  countFamilyExportRecords,
  FamilyExportValidationError,
  InMemoryFamilyExportCoordinator,
  InMemoryFamilyExportStore,
  runFamilyExport,
  sha256Hex,
  validateFamilyArchive,
  type FamilyArchiveBuild,
  type FamilyExportArchiveStore,
  type FamilyExportJobCoordinator,
  type FamilyExportLedgerJob,
  type FamilyExportManifest,
  type FamilyExportReadyResult,
  type FamilyExportRecords,
  type FamilyExportSnapshot,
} from ".";

const ids = {
  circle: "20000000-0000-4000-8000-000000000001",
  otherCircle: "20000000-0000-4000-8000-000000000002",
  adult: "30000000-0000-4000-8000-000000000001",
  child: "30000000-0000-4000-8000-000000000002",
  organizer: "40000000-0000-4000-8000-000000000001",
  formerMember: "40000000-0000-4000-8000-000000000002",
  guardian: "50000000-0000-4000-8000-000000000001",
  thought: "60000000-0000-4000-8000-000000000001",
  milestone: "60000000-0000-4000-8000-000000000002",
  note: "70000000-0000-4000-8000-000000000001",
  reaction: "80000000-0000-4000-8000-000000000001",
  export: "a0000000-0000-4000-8000-000000000001",
} as const;
const snapshotAt = "2026-08-30T20:00:00.000Z";
const createdAt = "2026-08-30T20:00:01.000Z";

function records(): FamilyExportRecords {
  return {
    circle: {
      id: ids.circle,
      name: "A Family",
      timeZone: "America/Los_Angeles",
      createdByMembershipId: ids.organizer,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    people: [
      {
        id: ids.child,
        circleId: ids.circle,
        displayName: "A Child",
        profileKind: "managed",
        accentToken: "sage",
        createdByMembershipId: ids.organizer,
        createdAt: "2020-01-02T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
      {
        id: ids.adult,
        circleId: ids.circle,
        displayName: "An Adult",
        profileKind: "account",
        accentToken: "clay",
        createdByMembershipId: ids.organizer,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
    memberships: [
      {
        id: ids.formerMember,
        circleId: ids.circle,
        personId: ids.child,
        role: "member",
        status: "revoked",
        joinedAt: "2020-01-02T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        revokedAt: "2025-01-01T00:00:00.000Z",
        revokedByMembershipId: ids.organizer,
      },
      {
        id: ids.organizer,
        circleId: ids.circle,
        personId: ids.adult,
        role: "organizer",
        status: "active",
        joinedAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        revokedAt: null,
        revokedByMembershipId: null,
      },
    ],
    guardians: [
      {
        id: ids.guardian,
        circleId: ids.circle,
        managedPersonId: ids.child,
        guardianMembershipId: ids.organizer,
        createdByMembershipId: ids.organizer,
        createdAt: "2020-01-02T00:00:00.000Z",
        revokedAt: null,
        revokedByMembershipId: null,
      },
    ],
    moments: [
      {
        id: ids.milestone,
        circleId: ids.circle,
        journalPersonId: ids.child,
        recordedByMembershipId: ids.organizer,
        kind: "milestone",
        title: "First step",
        body: "Right into waiting arms.",
        placeName: "Home",
        occurredOn: "2021-03-04",
        occurredAt: null,
        occurredTimezone: null,
        timePrecision: "date",
        revision: 2,
        createdAt: "2021-03-05T00:00:00.000Z",
        updatedAt: "2025-02-01T00:00:00.000Z",
        trashedAt: "2025-02-01T00:00:00.000Z",
        trashedByMembershipId: ids.organizer,
      },
      {
        id: ids.thought,
        circleId: ids.circle,
        journalPersonId: ids.adult,
        recordedByMembershipId: ids.organizer,
        kind: "thought",
        title: null,
        body: "A quiet morning.",
        placeName: null,
        occurredOn: "2021-03-03",
        occurredAt: "2021-03-03T17:15:00.000Z",
        occurredTimezone: "America/Los_Angeles",
        timePrecision: "minute",
        revision: 1,
        createdAt: "2021-03-03T17:16:00.000Z",
        updatedAt: "2021-03-03T17:16:00.000Z",
        trashedAt: null,
        trashedByMembershipId: null,
      },
    ],
    momentPeople: [
      {
        circleId: ids.circle,
        momentId: ids.thought,
        personId: ids.child,
        taggedByMembershipId: ids.organizer,
        createdAt: "2021-03-03T17:16:00.000Z",
        removedAt: "2022-01-01T00:00:00.000Z",
      },
    ],
    notes: [
      {
        id: ids.note,
        circleId: ids.circle,
        momentId: ids.thought,
        authorMembershipId: ids.organizer,
        body: "Still makes me smile.",
        revision: 2,
        createdAt: "2021-03-04T00:00:00.000Z",
        updatedAt: "2022-03-04T00:00:00.000Z",
        trashedAt: "2022-03-04T00:00:00.000Z",
      },
    ],
    reactions: [
      {
        id: ids.reaction,
        circleId: ids.circle,
        momentId: ids.thought,
        authorMembershipId: ids.organizer,
        reactionType: "remember-this",
        revision: 2,
        createdAt: "2021-03-04T00:00:00.000Z",
        updatedAt: "2022-03-04T00:00:00.000Z",
        removedAt: "2022-03-04T00:00:00.000Z",
      },
    ],
  };
}

function snapshot(
  overrides: Partial<FamilyExportRecords> = {},
): FamilyExportSnapshot {
  const value = { ...records(), ...overrides };
  return {
    ...value,
    snapshotAt,
    sourceSelection: {
      version: 1,
      selectionId: sha256Hex(canonicalJsonBytes("source-transaction-42")),
      expectedRecordCounts: countFamilyExportRecords(value),
      expectedRecordsSha256: computeFamilyRecordsSha256(value),
    },
  };
}

function job(value = snapshot()): FamilyExportLedgerJob {
  return {
    exportId: ids.export,
    circleId: ids.circle,
    requesterMembershipId: ids.organizer,
    authorizationVersion: "2026-08-30T19:59:00.000Z",
    snapshotAt,
    createdAt,
    snapshotSha256: computeFamilySnapshotSha256(value),
    snapshot: value,
  };
}

function build(value = snapshot()) {
  const ledger = job(value);
  return buildFamilyArchive({ ...ledger });
}

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    key,
    ...keysDeep(item),
  ]);
}

function parsedRecords(archive: FamilyArchiveBuild): FamilyExportRecords {
  return JSON.parse(
    new TextDecoder().decode(archive.files.get("data/family-records.json")!),
  ) as FamilyExportRecords;
}

function withFiles(
  archive: FamilyArchiveBuild,
  updates: readonly [string, Uint8Array][],
): FamilyArchiveBuild {
  const files = new Map(archive.files);
  updates.forEach(([path, bytes]) => files.set(path, bytes));
  return { manifest: archive.manifest, files };
}

function withManifest(
  archive: FamilyArchiveBuild,
  manifest: FamilyExportManifest,
): FamilyArchiveBuild {
  return {
    manifest,
    files: new Map(
      [...archive.files].map(([path, bytes]) => [
        path,
        path === "manifest.json" ? canonicalJsonBytes(manifest) : bytes,
      ]),
    ),
  };
}

describe("family export contract", () => {
  it("emits canonical retained records, explicit lifecycle scope, and zero media", () => {
    const archive = build();
    expect(archive.manifest).toMatchObject({
      format: "our-days-family-export",
      version: 1,
      media: { version: 1, originals: [] },
      lifecycleScope: {
        selectionAuthority: "source-adapter",
        retentionPolicy: "unspecified",
        memberships: { active: 1, revoked: 1 },
        moments: { live: 1, trashed: 1 },
      },
      inventory: {
        counts: {
          people: 2,
          memberships: 2,
          guardians: 1,
          moments: 2,
          momentPeople: 1,
          notes: 1,
          reactions: 1,
          mediaOriginals: 0,
          archiveFiles: 2,
        },
      },
    });
    expect([...archive.files.keys()].sort()).toEqual([
      "data/family-records.json",
      "manifest.json",
    ]);
    expect(parsedRecords(archive).people.map((person) => person.id)).toEqual([
      ids.adult,
      ids.child,
    ]);
  });

  it("keeps content only in the canonical records file, not manifest.json", () => {
    const archive = build();
    const manifestText = new TextDecoder().decode(
      archive.files.get("manifest.json")!,
    );
    for (const canary of [
      "A Family",
      "A Child",
      "An Adult",
      "First step",
      "Right into waiting arms.",
      "Home",
      "A quiet morning.",
      "Still makes me smile.",
      "remember-this",
    ])
      expect(manifestText).not.toContain(canary);
    expect(manifestText).not.toContain('"records"');
    expect(
      new TextDecoder().decode(archive.files.get("data/family-records.json")!),
    ).toContain("A quiet morning.");
  });

  it("contains no Auth user IDs and recursively rejects auth/email/session/token fields", () => {
    const archive = build();
    const allKeys = keysDeep({
      manifest: archive.manifest,
      records: parsedRecords(archive),
    }).map((key) => key.toLowerCase());
    expect(allKeys).not.toEqual(
      expect.arrayContaining([
        "userid",
        "recordedbyuserid",
        "trashedbyuserid",
        "email",
        "sessionid",
      ]),
    );
    for (const forbidden of [
      "userId",
      "auth_user_id",
      "emailAddress",
      "sessionId",
      "refreshToken",
    ]) {
      const value = snapshot() as unknown as Record<string, unknown>;
      (value.people as unknown[])[0] = {
        ...(value.people as Record<string, unknown>[])[0],
        nested: { [forbidden]: "secret" },
      };
      expect(() =>
        computeFamilySnapshotSha256(value as unknown as FamilyExportSnapshot),
      ).toThrow(/Forbidden Auth|unsupported/u);
    }
  });

  it("serializes deterministically regardless of source row order", () => {
    const first = build();
    const original = snapshot();
    const reversedRecords = {
      ...original,
      people: [...original.people].reverse(),
      memberships: [...original.memberships].reverse(),
      moments: [...original.moments].reverse(),
    };
    const secondSnapshot = snapshot(reversedRecords);
    const second = build(secondSnapshot);
    expect(
      bytesEqual(
        first.files.get("data/family-records.json")!,
        second.files.get("data/family-records.json")!,
      ),
    ).toBe(true);
    expect(first.manifest.snapshotSha256).toBe(second.manifest.snapshotSha256);
  });

  it("detects source omissions against independently supplied counts and digest", () => {
    const complete = snapshot();
    const omitted = { ...complete, notes: [] } as FamilyExportSnapshot;
    expect(() => computeFamilySnapshotSha256(omitted)).toThrow(
      /expected counts|digest/u,
    );
    const forgedCounts = {
      ...omitted,
      sourceSelection: {
        ...omitted.sourceSelection,
        expectedRecordCounts: countFamilyExportRecords(omitted),
      },
    };
    expect(() => computeFamilySnapshotSha256(forgedCounts)).toThrow(
      /expected records digest/u,
    );
  });

  it("rejects media in v1 at both snapshot and manifest boundaries", () => {
    expect(() =>
      computeFamilySnapshotSha256({
        ...snapshot(),
        media: [],
      } as unknown as FamilyExportSnapshot),
    ).toThrow(/unsupported or missing field/u);
    const archive = build();
    const manifest = {
      ...archive.manifest,
      media: { version: 1, originals: [{ path: "media/x.jpg" }] },
    } as unknown as FamilyExportManifest;
    expect(() =>
      validateFamilyArchive(withManifest(archive, manifest)),
    ).toThrow(/must be empty/u);
  });

  it("rejects cross-circle and duplicate rows", () => {
    const base = records();
    expect(() =>
      computeFamilySnapshotSha256(
        snapshot({
          people: [
            { ...base.people[0], circleId: ids.otherCircle },
            ...base.people.slice(1),
          ],
        }),
      ),
    ).toThrow(/another circle/u);
    expect(() =>
      computeFamilySnapshotSha256(
        snapshot({ people: [...base.people, base.people[0]] }),
      ),
    ).toThrow(/duplicate identities/u);
  });

  it("rejects unsafe and extra archive paths", () => {
    const archive = build();
    const manifest = {
      ...archive.manifest,
      inventory: {
        ...archive.manifest.inventory,
        recordsFile: {
          ...archive.manifest.inventory.recordsFile,
          path: "../records.json",
        },
      },
    } as unknown as FamilyExportManifest;
    expect(() =>
      validateFamilyArchive(withManifest(archive, manifest)),
    ).toThrow(/unsafe|allowlist/u);
    const files = new Map(archive.files);
    files.set("data/private.json", new Uint8Array());
    expect(() =>
      validateFamilyArchive({ manifest: archive.manifest, files }),
    ).toThrow(/unsafe|unlisted/u);
  });

  it("decodes, parses, checksums, and canonical-validates records independently", () => {
    const archive = build();
    const recordsBytes = archive.files.get("data/family-records.json")!;
    expect(() =>
      validateFamilyArchive(
        withFiles(archive, [
          ["data/family-records.json", new Uint8Array([0xff])],
        ]),
      ),
    ).toThrow(/byte count|checksum|UTF-8/u);
    const nonCanonical = new TextEncoder().encode(
      JSON.stringify(parsedRecords(archive), null, 2),
    );
    const manifest = {
      ...archive.manifest,
      inventory: {
        ...archive.manifest.inventory,
        recordsFile: {
          ...archive.manifest.inventory.recordsFile,
          byteLength: nonCanonical.byteLength,
          sha256: sha256Hex(nonCanonical),
        },
      },
    };
    expect(() =>
      validateFamilyArchive(
        withFiles(withManifest(archive, manifest), [
          ["data/family-records.json", nonCanonical],
        ]),
      ),
    ).toThrow(/not canonical/u);
    const manifestPretty = new TextEncoder().encode(
      JSON.stringify(archive.manifest, null, 2),
    );
    expect(() =>
      validateFamilyArchive(
        withFiles(archive, [["manifest.json", manifestPretty]]),
      ),
    ).toThrow(/not canonical/u);
    expect(recordsBytes.byteLength).toBeGreaterThan(0);
  });

  it.each([
    [
      "future circle update",
      (base: FamilyExportRecords) => ({
        ...base,
        circle: { ...base.circle, updatedAt: "2027-01-01T00:00:00.000Z" },
      }),
      /snapshot time/u,
    ],
    [
      "invalid role",
      (base: FamilyExportRecords) => ({
        ...base,
        memberships: base.memberships.map((row) => ({ ...row, role: "owner" })),
      }),
      /unsupported value/u,
    ],
    [
      "zero revision",
      (base: FamilyExportRecords) => ({
        ...base,
        moments: base.moments.map((row) => ({ ...row, revision: 0 })),
      }),
      /at least 1/u,
    ],
    [
      "invalid membership state",
      (base: FamilyExportRecords) => ({
        ...base,
        memberships: base.memberships.map((row) =>
          row.status === "revoked" ? { ...row, revokedAt: null } : row,
        ),
      }),
      /inconsistent revocation/u,
    ],
    [
      "invalid minute state",
      (base: FamilyExportRecords) => ({
        ...base,
        moments: base.moments.map((row) =>
          row.timePrecision === "minute"
            ? { ...row, occurredTimezone: null }
            : row,
        ),
      }),
      /occurrence precision/u,
    ],
    [
      "invalid accent",
      (base: FamilyExportRecords) => ({
        ...base,
        people: base.people.map((row) => ({ ...row, accentToken: "neon" })),
      }),
      /unsupported value/u,
    ],
  ])(
    "validates runtime enums, revisions, lifecycle pairs, and timestamps: %s",
    (_name, mutate, message) => {
      const value = mutate(records()) as FamilyExportRecords;
      const raw = {
        ...value,
        snapshotAt,
        sourceSelection: {
          version: 1,
          selectionId: "1".repeat(64),
          expectedRecordCounts: countFamilyExportRecords(value),
          expectedRecordsSha256: computeFamilyRecordsSha256(value),
        },
      } as FamilyExportSnapshot;
      expect(() => computeFamilySnapshotSha256(raw)).toThrow(message);
    },
  );

  it("binds the manifest to the immutable snapshot digest", () => {
    const value = snapshot();
    expect(() =>
      buildFamilyArchive({ ...job(value), snapshotSha256: "0".repeat(64) }),
    ).toThrow(/immutable snapshot digest/u);
    const archive = build();
    const manifest = { ...archive.manifest, snapshotSha256: "0".repeat(64) };
    expect(() =>
      validateFamilyArchive(withManifest(archive, manifest)),
    ).toThrow(/Snapshot digest/u);
  });
});

type CoordinatorOverrides = Partial<FamilyExportJobCoordinator>;
function coordinatorWith(
  base: InMemoryFamilyExportCoordinator,
  overrides: CoordinatorOverrides,
): FamilyExportJobCoordinator {
  return {
    loadJob: overrides.loadJob ?? ((id) => base.loadJob(id)),
    readReadyIfAuthorized:
      overrides.readReadyIfAuthorized ??
      ((input) => base.readReadyIfAuthorized(input)),
    publishReadyAtomically:
      overrides.publishReadyAtomically ??
      ((input) => base.publishReadyAtomically(input)),
  };
}

describe("family export retry and authority harness", () => {
  it("accepts only exportId and denies fabricated or nonexistent jobs", async () => {
    const coordinator = new InMemoryFamilyExportCoordinator(job());
    await expect(
      runFamilyExport({
        exportId: ids.otherCircle,
        coordinator,
        store: new InMemoryFamilyExportStore(),
      }),
    ).rejects.toThrow(/does not exist/u);
    expect(Object.keys({ exportId: ids.export })).toEqual(["exportId"]);
  });

  it("resumes every partial missing-file boundary", async () => {
    for (const failingIndex of [0, 1]) {
      const store = new InMemoryFamilyExportStore();
      const coordinator = new InMemoryFamilyExportCoordinator(job());
      let failed = false;
      await expect(
        runFamilyExport({
          exportId: ids.export,
          coordinator,
          store,
          injectFault(progress) {
            if (
              !failed &&
              progress.stage === "file-staged" &&
              progress.index === failingIndex
            ) {
              failed = true;
              throw new Error("injected file failure");
            }
          },
        }),
      ).rejects.toThrow("injected file failure");
      const ready = await runFamilyExport({
        exportId: ids.export,
        coordinator,
        store,
      });
      expect(ready.archiveFileCount).toBe(2);
      expect(coordinator.readyWrites).toBe(1);
      expect(await store.list(`${ready.archivePrefix}/`)).toHaveLength(2);
    }
  });

  it("recovers after verification and a lost ready response", async () => {
    for (const stage of ["verified", "ready"] as const) {
      const store = new InMemoryFamilyExportStore();
      const coordinator = new InMemoryFamilyExportCoordinator(job());
      let failed = false;
      await expect(
        runFamilyExport({
          exportId: ids.export,
          coordinator,
          store,
          injectFault(progress) {
            if (!failed && progress.stage === stage) {
              failed = true;
              throw new Error(`injected ${stage} failure`);
            }
          },
        }),
      ).rejects.toThrow(`injected ${stage} failure`);
      await expect(
        runFamilyExport({ exportId: ids.export, coordinator, store }),
      ).resolves.toMatchObject({ archiveFileCount: 2 });
      expect(coordinator.readyWrites).toBe(1);
    }
  });

  it("fails closed on mismatched partial bytes and never rewrites them", async () => {
    const base = new InMemoryFamilyExportStore();
    const coordinator = new InMemoryFamilyExportCoordinator(job());
    let failed = false;
    await expect(
      runFamilyExport({
        exportId: ids.export,
        coordinator,
        store: base,
        injectFault(progress) {
          if (!failed && progress.stage === "file-staged") {
            failed = true;
            throw new Error("stop");
          }
        },
      }),
    ).rejects.toThrow("stop");
    const [path] = await base.list("family-exports/");
    const corrupt = new Uint8Array([9, 9, 9]);
    await base.write(path, corrupt);
    let writes = 0;
    const store: FamilyExportArchiveStore = {
      read: (key) => base.read(key),
      list: (prefix) => base.list(prefix),
      async write(key, bytes) {
        writes += 1;
        return base.write(key, bytes);
      },
    };
    await expect(
      runFamilyExport({ exportId: ids.export, coordinator, store }),
    ).rejects.toThrow(/conflicts with the immutable snapshot/u);
    expect(writes).toBe(0);
    expect(await base.read(path)).toEqual(corrupt);
    expect(coordinator.readyWrites).toBe(0);
  });

  it("rejects changed source data for the same job before staging bytes", async () => {
    const original = job();
    const changed = snapshot({
      ...records(),
      moments: records().moments.map((row) =>
        row.id === ids.thought ? { ...row, body: "changed" } : row,
      ),
    });
    const coordinator = new InMemoryFamilyExportCoordinator({
      ...original,
      snapshot: changed,
    });
    let writes = 0;
    const base = new InMemoryFamilyExportStore();
    const store: FamilyExportArchiveStore = {
      read: (path) => base.read(path),
      list: (prefix) => base.list(prefix),
      async write(path, bytes) {
        writes += 1;
        await base.write(path, bytes);
      },
    };
    await expect(
      runFamilyExport({ exportId: ids.export, coordinator, store }),
    ).rejects.toThrow(/immutable snapshot digest/u);
    expect(writes).toBe(0);
  });

  it("denies revocation after staging but before atomic publication", async () => {
    const coordinator = new InMemoryFamilyExportCoordinator(job());
    const store = new InMemoryFamilyExportStore();
    await expect(
      runFamilyExport({
        exportId: ids.export,
        coordinator,
        store,
        injectFault(progress) {
          if (progress.stage === "verified")
            coordinator.setActiveOrganizer(false);
        },
      }),
    ).rejects.toThrow(/not currently authorized/u);
    expect(coordinator.readyWrites).toBe(0);
  });

  it("authorizes existing-ready reads and denies a revoked requester", async () => {
    const coordinator = new InMemoryFamilyExportCoordinator(job());
    const store = new InMemoryFamilyExportStore();
    await runFamilyExport({ exportId: ids.export, coordinator, store });
    coordinator.setActiveOrganizer(false);
    await expect(
      runFamilyExport({ exportId: ids.export, coordinator, store }),
    ).rejects.toThrow(/not currently authorized/u);
  });

  it("reauthorizes an existing ready export after storage validation", async () => {
    const coordinator = new InMemoryFamilyExportCoordinator(job());
    const store = new InMemoryFamilyExportStore();
    await runFamilyExport({ exportId: ids.export, coordinator, store });
    const revokingStore: FamilyExportArchiveStore = {
      read: (path) => store.read(path),
      write: (path, bytes) => store.write(path, bytes),
      async list(prefix) {
        const paths = await store.list(prefix);
        coordinator.setActiveOrganizer(false);
        return paths;
      },
    };

    await expect(
      runFamilyExport({
        exportId: ids.export,
        coordinator,
        store: revokingStore,
      }),
    ).rejects.toThrow(/not currently authorized/u);
  });

  it("converges concurrent publication on one ready result", async () => {
    const coordinator = new InMemoryFamilyExportCoordinator(job());
    const store = new InMemoryFamilyExportStore();
    const [left, right] = await Promise.all([
      runFamilyExport({ exportId: ids.export, coordinator, store }),
      runFamilyExport({ exportId: ids.export, coordinator, store }),
    ]);
    expect(left).toEqual(right);
    expect(coordinator.readyWrites).toBe(1);
  });

  it.each([
    "archivePrefix",
    "manifestPath",
    "manifestSha256",
    "archiveFileCount",
  ] as const)("rejects mutated existing-ready field %s", async (field) => {
    const base = new InMemoryFamilyExportCoordinator(job());
    const store = new InMemoryFamilyExportStore();
    const ready = await runFamilyExport({
      exportId: ids.export,
      coordinator: base,
      store,
    });
    const mutated = {
      ...ready,
      [field]:
        field === "archiveFileCount"
          ? ready.archiveFileCount + 1
          : `${ready[field]}-mutated`,
    } as FamilyExportReadyResult;
    const coordinator = coordinatorWith(base, {
      async readReadyIfAuthorized() {
        return mutated;
      },
    });
    await expect(
      runFamilyExport({ exportId: ids.export, coordinator, store }),
    ).rejects.toThrow(/conflicting ready result/u);
  });

  it.each([
    "archivePrefix",
    "manifestPath",
    "manifestSha256",
    "archiveFileCount",
  ] as const)("rejects mutated atomic-publish field %s", async (field) => {
    const base = new InMemoryFamilyExportCoordinator(job());
    const coordinator = coordinatorWith(base, {
      async publishReadyAtomically(input) {
        const value = await base.publishReadyAtomically(input);
        return {
          ...value,
          [field]:
            field === "archiveFileCount"
              ? value.archiveFileCount + 1
              : `${value[field]}-mutated`,
        } as FamilyExportReadyResult;
      },
    });
    await expect(
      runFamilyExport({
        exportId: ids.export,
        coordinator,
        store: new InMemoryFamilyExportStore(),
      }),
    ).rejects.toThrow(/conflicting ready result/u);
  });

  it("rejects cross-circle coordinator snapshots and hostile store listings", async () => {
    const crossed = snapshot();
    const coordinator = new InMemoryFamilyExportCoordinator({
      ...job(crossed),
      circleId: ids.otherCircle,
    });
    await expect(
      runFamilyExport({
        exportId: ids.export,
        coordinator,
        store: new InMemoryFamilyExportStore(),
      }),
    ).rejects.toThrow(/another circle/u);
    const base = new InMemoryFamilyExportStore();
    const hostile: FamilyExportArchiveStore = {
      read: (path) => base.read(path),
      write: (path, bytes) => base.write(path, bytes),
      async list(prefix) {
        return [...(await base.list(prefix)), "another-prefix/private.bin"];
      },
    };
    await expect(
      runFamilyExport({
        exportId: ids.export,
        coordinator: new InMemoryFamilyExportCoordinator(job()),
        store: hostile,
      }),
    ).rejects.toBeInstanceOf(FamilyExportValidationError);
  });
});
