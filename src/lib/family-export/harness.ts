import { createHash } from "node:crypto";
import {
  buildFamilyArchive,
  bytesEqual,
  canonicalJsonBytes,
  FamilyExportValidationError,
  sha256Hex,
  validateFamilyArchive,
  type FamilyArchiveBuild,
  type FamilyExportSnapshot,
} from "./contract";

/** Immutable values loaded from the durable export ledger, never caller input. */
export type FamilyExportLedgerJob = Readonly<{
  exportId: string;
  circleId: string;
  requesterMembershipId: string;
  authorizationVersion: string;
  snapshotAt: string;
  createdAt: string;
  snapshotSha256: string;
  snapshot: FamilyExportSnapshot;
}>;

export type FamilyExportReadyResult = Readonly<{
  archivePrefix: string;
  manifestPath: string;
  manifestSha256: string;
  archiveFileCount: number;
}>;

/**
 * Production implementations belong behind a privileged durable coordinator
 * (normally one transaction/RPC), not in browser code.
 */
export interface FamilyExportJobCoordinator {
  loadJob(exportId: string): Promise<FamilyExportLedgerJob | null>;

  /**
   * Must authorize the recorded requester and authorization version before
   * returning an existing result. Revoked/invalidated jobs must fail closed.
   */
  readReadyIfAuthorized(
    input: Readonly<{
      exportId: string;
      authorizationVersion: string;
    }>,
  ): Promise<FamilyExportReadyResult | null>;

  /**
   * ATOMIC compare-and-set contract: in the same operation, lock/load the
   * ledger job, verify its immutable snapshot digest and authorization
   * version, recheck that the recorded requester is currently an active
   * organizer, reject terminal invalidation, then insert-or-compare every ready
   * result field. It must never publish after a separate stale auth check.
   */
  publishReadyAtomically(
    input: Readonly<{
      exportId: string;
      authorizationVersion: string;
      snapshotSha256: string;
      result: FamilyExportReadyResult;
    }>,
  ): Promise<FamilyExportReadyResult>;
}

export interface FamilyExportArchiveStore {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
}

export type FamilyExportProgress =
  | Readonly<{
      stage: "file-staged";
      path: string;
      index: number;
      total: number;
    }>
  | Readonly<{ stage: "verified"; total: number }>
  | Readonly<{ stage: "ready"; total: number }>;
export type FamilyExportFaultInjector = (
  progress: FamilyExportProgress,
) => void | Promise<void>;

function keyFor(exportId: string) {
  return createHash("sha256")
    .update(`our-days-family-export\0${exportId}`)
    .digest("hex")
    .slice(0, 48);
}
function prefixFor(key: string) {
  return `family-exports/${key}`;
}
function storedPath(prefix: string, relativePath: string) {
  return `${prefix}/${relativePath}`;
}
function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function readyEqual(
  left: FamilyExportReadyResult,
  right: FamilyExportReadyResult,
) {
  return (
    left.archivePrefix === right.archivePrefix &&
    left.manifestPath === right.manifestPath &&
    left.manifestSha256 === right.manifestSha256 &&
    left.archiveFileCount === right.archiveFileCount
  );
}
function requireReadyEqual(
  actual: FamilyExportReadyResult,
  expected: FamilyExportReadyResult,
) {
  if (!readyEqual(actual, expected))
    throw new FamilyExportValidationError(
      "The coordinator returned a conflicting ready result.",
    );
}

function expectedArchive(job: FamilyExportLedgerJob): FamilyArchiveBuild {
  if (job.snapshot.circle.id !== job.circleId)
    throw new FamilyExportValidationError(
      "The coordinator returned a snapshot from another circle.",
    );
  return buildFamilyArchive({
    exportId: job.exportId,
    requesterMembershipId: job.requesterMembershipId,
    snapshotAt: job.snapshotAt,
    createdAt: job.createdAt,
    snapshotSha256: job.snapshotSha256,
    snapshot: job.snapshot,
  });
}

async function readStoredArchive(
  store: FamilyExportArchiveStore,
  prefix: string,
  expected: FamilyArchiveBuild,
): Promise<FamilyArchiveBuild> {
  const files = new Map<string, Uint8Array>();
  for (const relativePath of expected.files.keys()) {
    const bytes = await store.read(storedPath(prefix, relativePath));
    if (!bytes)
      throw new FamilyExportValidationError(
        "A staged archive file disappeared before verification.",
      );
    files.set(relativePath, bytes);
  }
  const listed = await store.list(`${prefix}/`);
  if (listed.some((path) => !path.startsWith(`${prefix}/`)))
    throw new FamilyExportValidationError(
      "The archive store returned a path outside the requested prefix.",
    );
  if (
    listed.length !== files.size ||
    listed.some((path) => !files.has(path.slice(prefix.length + 1)))
  )
    throw new FamilyExportValidationError(
      "The staged archive contains an unexpected file.",
    );
  return { manifest: expected.manifest, files };
}

/** Worker entrypoint. Only an opaque durable-ledger ID is accepted from a caller. */
export async function runFamilyExport(
  input: Readonly<{
    exportId: string;
    coordinator: FamilyExportJobCoordinator;
    store: FamilyExportArchiveStore;
    injectFault?: FamilyExportFaultInjector;
  }>,
): Promise<FamilyExportReadyResult> {
  const job = await input.coordinator.loadJob(input.exportId);
  if (!job || job.exportId !== input.exportId)
    throw new FamilyExportValidationError(
      "The export job does not exist or cannot be loaded.",
    );
  if (
    !Number.isFinite(new Date(job.authorizationVersion).valueOf()) ||
    new Date(job.authorizationVersion).toISOString() !==
      job.authorizationVersion
  )
    throw new FamilyExportValidationError(
      "The export job has an invalid authorization version.",
    );

  // This is the authorization gate before any snapshot material is built or
  // existing ready result is revealed.
  const existingReady = await input.coordinator.readReadyIfAuthorized({
    exportId: job.exportId,
    authorizationVersion: job.authorizationVersion,
  });

  const expected = expectedArchive(job);
  const key = keyFor(job.exportId);
  const prefix = prefixFor(key);
  const desired: FamilyExportReadyResult = {
    archivePrefix: prefix,
    manifestPath: storedPath(prefix, "manifest.json"),
    manifestSha256: sha256Hex(canonicalJsonBytes(expected.manifest)),
    archiveFileCount: expected.files.size,
  };

  if (existingReady) {
    requireReadyEqual(existingReady, desired);
    validateFamilyArchive(
      await readStoredArchive(input.store, prefix, expected),
    );
    // Storage verification may take long enough for the requester to lose
    // authority. Recheck immediately before revealing the ready record;
    // artifact delivery must perform its own fresh authorization as well.
    const reauthorizedReady = await input.coordinator.readReadyIfAuthorized({
      exportId: job.exportId,
      authorizationVersion: job.authorizationVersion,
    });
    if (!reauthorizedReady)
      throw new FamilyExportValidationError(
        "The ready export disappeared during authorization.",
      );
    requireReadyEqual(reauthorizedReady, desired);
    requireReadyEqual(reauthorizedReady, existingReady);
    return reauthorizedReady;
  }

  const entries = [...expected.files.entries()].sort(([left], [right]) =>
    ordinalCompare(left, right),
  );
  for (const [index, [relativePath, bytes]] of entries.entries()) {
    const path = storedPath(prefix, relativePath);
    const existing = await input.store.read(path);
    if (existing && !bytesEqual(existing, bytes))
      throw new FamilyExportValidationError(
        "A staged archive file conflicts with the immutable snapshot.",
      );
    if (!existing) await input.store.write(path, bytes);
    await input.injectFault?.({
      stage: "file-staged",
      path: relativePath,
      index,
      total: entries.length,
    });
  }

  validateFamilyArchive(await readStoredArchive(input.store, prefix, expected));
  await input.injectFault?.({ stage: "verified", total: entries.length });
  const ready = await input.coordinator.publishReadyAtomically({
    exportId: job.exportId,
    authorizationVersion: job.authorizationVersion,
    snapshotSha256: job.snapshotSha256,
    result: desired,
  });
  requireReadyEqual(ready, desired);
  await input.injectFault?.({ stage: "ready", total: entries.length });
  return ready;
}

export class InMemoryFamilyExportStore implements FamilyExportArchiveStore {
  readonly #files = new Map<string, Uint8Array>();
  async read(path: string) {
    const value = this.#files.get(path);
    return value ? new Uint8Array(value) : null;
  }
  async write(path: string, bytes: Uint8Array) {
    this.#files.set(path, new Uint8Array(bytes));
  }
  async list(prefix: string) {
    return [...this.#files.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort(ordinalCompare);
  }
}

/** Pure test double for the coordinator contract; it is not a DB-worker claim. */
export class InMemoryFamilyExportCoordinator implements FamilyExportJobCoordinator {
  #job: FamilyExportLedgerJob | null;
  #ready: FamilyExportReadyResult | null = null;
  #activeOrganizer = true;
  #readyWrites = 0;
  constructor(job: FamilyExportLedgerJob | null) {
    this.#job = job;
  }
  get readyWrites() {
    return this.#readyWrites;
  }
  setActiveOrganizer(value: boolean) {
    this.#activeOrganizer = value;
  }
  replaceJob(job: FamilyExportLedgerJob | null) {
    this.#job = job;
  }
  async loadJob(exportId: string) {
    return this.#job?.exportId === exportId ? this.#job : null;
  }
  #authorize(exportId: string, version: string) {
    if (
      !this.#job ||
      this.#job.exportId !== exportId ||
      this.#job.authorizationVersion !== version ||
      !this.#activeOrganizer
    )
      throw new FamilyExportValidationError(
        "The recorded requester is not currently authorized for this export.",
      );
  }
  async readReadyIfAuthorized(
    input: Readonly<{ exportId: string; authorizationVersion: string }>,
  ) {
    this.#authorize(input.exportId, input.authorizationVersion);
    return this.#ready;
  }
  async publishReadyAtomically(
    input: Readonly<{
      exportId: string;
      authorizationVersion: string;
      snapshotSha256: string;
      result: FamilyExportReadyResult;
    }>,
  ) {
    this.#authorize(input.exportId, input.authorizationVersion);
    if (this.#job?.snapshotSha256 !== input.snapshotSha256)
      throw new FamilyExportValidationError(
        "The immutable snapshot digest changed before publication.",
      );
    if (this.#ready) {
      requireReadyEqual(this.#ready, input.result);
      return this.#ready;
    }
    this.#ready = { ...input.result };
    this.#readyWrites += 1;
    return this.#ready;
  }
}
