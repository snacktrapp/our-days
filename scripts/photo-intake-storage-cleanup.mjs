import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const INTAKE_BUCKET = "our-days-intake";
const ORIGINALS_BUCKET = "our-days-originals";
const intakePathPattern =
  /^intake\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

function byteLabel(bytes) {
  return Intl.NumberFormat("en-US").format(bytes);
}

function toTableRows(rows, mapper) {
  return rows.map((row) => mapper(row));
}

async function listBucketFiles(client, bucket, rootPrefix) {
  const queue = [rootPrefix];
  const files = [];

  while (queue.length > 0) {
    const prefix = queue.shift();
    let offset = 0;
    while (true) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        throw new Error(`Could not list ${bucket}/${prefix ?? ""}: ${error.message}`);
      }
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) {
          files.push({
            id: entry.id,
            metadata: entry.metadata ?? null,
            name: fullPath,
          });
        } else {
          queue.push(fullPath);
        }
      }

      if (data.length < 100) break;
      offset += data.length;
    }
  }

  return files;
}

async function hashStorageObject(client, bucket, objectPath, cache) {
  const cacheKey = `${bucket}:${objectPath}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error || !data) {
    throw new Error(`Could not download ${bucket}/${objectPath}: ${error?.message ?? "unknown error"}`);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const hashed = {
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
  cache.set(cacheKey, hashed);
  return hashed;
}

function intakeIdFromPath(path) {
  return intakePathPattern.exec(path)?.[1] ?? null;
}

function intakeIdFromOriginalInfo(info) {
  if (!info || typeof info !== "object") return null;
  const candidates = [
    info.user_metadata,
    info.metadata?.user_metadata,
    info.metadata?.userMetadata,
    info.metadata,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const intakeId =
      (typeof candidate.intake_id === "string" && candidate.intake_id) ||
      (typeof candidate.intakeId === "string" && candidate.intakeId) ||
      null;
    if (intakeId) return intakeId;
  }
  return null;
}

export function assertIdenticalDeletionCandidates(candidates) {
  const nonIdentical = candidates.filter(
    (candidate) => !candidate.shaMatch || !candidate.sizeMatch,
  );
  if (nonIdentical.length > 0) {
    throw new Error("Refusing cleanup: non-identical file candidates were provided.");
  }
}

export async function deleteIntakeObjects(client, candidates) {
  assertIdenticalDeletionCandidates(candidates);
  const paths = [...new Set(candidates.map((candidate) => candidate.intakePath))];
  if (paths.length === 0) return [];
  const { data, error } = await client.storage.from(INTAKE_BUCKET).remove(paths);
  if (error) {
    throw new Error(`Cleanup delete failed: ${error.message}`);
  }
  return data ?? [];
}

export async function runIntakeCleanupReport({
  applyCleanup = false,
  client,
  log = console,
}) {
  const intakeFiles = await listBucketFiles(client, INTAKE_BUCKET, "intake");
  const originalFiles = await listBucketFiles(client, ORIGINALS_BUCKET, "original");

  const originalsByIntakeId = new Map();
  for (const original of originalFiles) {
    const { data: info, error } = await client.storage
      .from(ORIGINALS_BUCKET)
      .info(original.name);
    if (error) continue;
    const intakeId = intakeIdFromOriginalInfo(info);
    if (!intakeId) continue;
    const list = originalsByIntakeId.get(intakeId) ?? [];
    list.push({ originalPath: original.name });
    originalsByIntakeId.set(intakeId, list);
  }

  const hashCache = new Map();
  const identicalMatches = [];
  const mismatches = [];
  const orphans = [];

  for (const intake of intakeFiles) {
    const intakeId = intakeIdFromPath(intake.name);
    if (!intakeId) {
      mismatches.push({
        intakeId: "(invalid-path)",
        intakePath: intake.name,
        reason: "invalid_intake_path",
      });
      continue;
    }

    const candidates = originalsByIntakeId.get(intakeId) ?? [];
    if (candidates.length === 0) {
      const intakeHash = await hashStorageObject(
        client,
        INTAKE_BUCKET,
        intake.name,
        hashCache,
      );
      orphans.push({
        intakeId,
        intakePath: intake.name,
        intakeSha256Hex: intakeHash.sha256Hex,
        intakeSizeBytes: intakeHash.sizeBytes,
      });
      continue;
    }

    if (candidates.length > 1) {
      mismatches.push({
        intakeId,
        intakePath: intake.name,
        originalPath: "(multiple originals)",
        reason: "multiple_originals",
      });
      continue;
    }

    const [candidate] = candidates;
    const [intakeHash, originalHash] = await Promise.all([
      hashStorageObject(client, INTAKE_BUCKET, intake.name, hashCache),
      hashStorageObject(client, ORIGINALS_BUCKET, candidate.originalPath, hashCache),
    ]);
    const sizeMatch = intakeHash.sizeBytes === originalHash.sizeBytes;
    const shaMatch = intakeHash.sha256Hex === originalHash.sha256Hex;

    if (sizeMatch && shaMatch) {
      identicalMatches.push({
        intakeId,
        intakePath: intake.name,
        originalPath: candidate.originalPath,
        intakeSha256Hex: intakeHash.sha256Hex,
        intakeSizeBytes: intakeHash.sizeBytes,
        originalSha256Hex: originalHash.sha256Hex,
        originalSizeBytes: originalHash.sizeBytes,
        shaMatch,
        sizeMatch,
      });
      continue;
    }

    mismatches.push({
      intakeId,
      intakePath: intake.name,
      originalPath: candidate.originalPath,
      intakeSha256Hex: intakeHash.sha256Hex,
      intakeSizeBytes: intakeHash.sizeBytes,
      originalSha256Hex: originalHash.sha256Hex,
      originalSizeBytes: originalHash.sizeBytes,
      reason: sizeMatch ? "sha_mismatch" : "size_mismatch",
      shaMatch,
      sizeMatch,
    });
  }

  const reclaimableBytes = identicalMatches.reduce(
    (sum, match) => sum + match.intakeSizeBytes,
    0,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    mode: applyCleanup ? "cleanup" : "dry-run",
    totals: {
      intakesScanned: intakeFiles.length,
      originalsIndexed: originalFiles.length,
      byteIdenticalMatches: identicalMatches.length,
      mismatches: mismatches.length,
      orphans: orphans.length,
      reclaimableBytes,
    },
    byteIdenticalMatches: identicalMatches,
    mismatches,
    orphans,
  };

  log.info("\n== Intake duplicate report ==");
  log.table([
    {
      "Intakes scanned": report.totals.intakesScanned,
      "Originals indexed": report.totals.originalsIndexed,
      "Identical matches": report.totals.byteIdenticalMatches,
      Mismatches: report.totals.mismatches,
      Orphans: report.totals.orphans,
      "Reclaimable bytes": byteLabel(report.totals.reclaimableBytes),
    },
  ]);

  if (identicalMatches.length > 0) {
    log.info("\nByte-identical matches:");
    log.table(
      toTableRows(identicalMatches, (match) => ({
        "Intake ID": match.intakeId,
        "Intake path": match.intakePath,
        "Original path": match.originalPath,
        Bytes: byteLabel(match.intakeSizeBytes),
      })),
    );
  }

  if (mismatches.length > 0) {
    log.info("\nMismatches:");
    log.table(
      toTableRows(mismatches, (row) => ({
        "Intake ID": row.intakeId,
        "Intake path": row.intakePath,
        "Original path": row.originalPath ?? "(none)",
        Reason: row.reason,
      })),
    );
  }

  if (orphans.length > 0) {
    log.info("\nOrphans:");
    log.table(
      toTableRows(orphans, (row) => ({
        "Intake ID": row.intakeId,
        "Intake path": row.intakePath,
        Bytes: byteLabel(row.intakeSizeBytes),
      })),
    );
  }

  const plannedDeletes = identicalMatches.map((match) => ({
    intakeId: match.intakeId,
    intakePath: match.intakePath,
    originalPath: match.originalPath,
    shaMatch: match.shaMatch,
    sizeMatch: match.sizeMatch,
  }));
  log.info("\nPlanned intake deletes (identical matches only):");
  if (plannedDeletes.length > 0) {
    log.table(
      toTableRows(plannedDeletes, (row) => ({
        "Intake ID": row.intakeId,
        "Intake path": row.intakePath,
        "Original path": row.originalPath,
      })),
    );
  } else {
    log.info("None");
  }

  if (applyCleanup) {
    const deleted = await deleteIntakeObjects(client, plannedDeletes);
    log.info(`\nDeleted ${deleted.length} intake objects from ${INTAKE_BUCKET}.`);
  } else {
    log.info("\nDry run mode: no objects were deleted.");
  }

  log.info("\nJSON report:");
  log.info(JSON.stringify(report, null, 2));
  return report;
}

function parseArguments(argv) {
  const args = new Set(argv);
  return {
    applyCleanup: args.has("--apply-cleanup"),
    help: args.has("--help") || args.has("-h"),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main() {
  const { applyCleanup, help } = parseArguments(process.argv.slice(2));
  if (help) {
    console.log(
      [
        "Usage: node scripts/photo-intake-storage-cleanup.mjs [--apply-cleanup]",
        "",
        "Environment:",
        "  NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)",
        "  SUPABASE_SERVICE_ROLE_KEY",
        "",
        "Default mode is read-only dry run.",
      ].join("\n"),
    );
    return;
  }

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    process.env.SUPABASE_URL?.trim() ??
    "";
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is required.",
    );
  }
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await runIntakeCleanupReport({ applyCleanup, client });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
