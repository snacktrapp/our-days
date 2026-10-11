import "server-only";

import { withAuthenticatedPhotoWorkerClient } from "@/lib/photo-worker.server";
import {
  MOMENT_MEDIA_BUCKETS,
  MOMENT_MEDIA_PURGE_MOMENT_LIMIT,
  MOMENT_MEDIA_PURGE_REMOVE_BATCH,
  type MomentMediaBucket,
} from "./constants";

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

export type MomentMediaPurgeClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => PromiseLike<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
};

type PurgeCandidate = {
  moment_id: string;
  bucket_id: MomentMediaBucket;
  object_path: string;
};

type PurgeRecord = {
  recorded: boolean;
  reason: string;
};

export type MomentMediaPurgeResult = {
  listed: number;
  purged: number;
  retained: number;
};

const bucketSet = new Set<string>(MOMENT_MEDIA_BUCKETS);
const recordedReasons = new Set(["purged", "already_recorded"]);

function isCandidate(value: unknown): value is PurgeCandidate {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.moment_id === "string" &&
    typeof row.bucket_id === "string" &&
    bucketSet.has(row.bucket_id) &&
    typeof row.object_path === "string" &&
    row.object_path.length > 0 &&
    row.object_path.length <= 1024 &&
    !row.object_path.includes("..")
  );
}

function isPurgeRecord(value: unknown): value is PurgeRecord {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.recorded === "boolean" && typeof row.reason === "string";
}

function removalErrorIsMissing(error: { message: string } | null) {
  if (!error) return false;
  return /not found|does not exist/iu.test(error.message);
}

function chunks<T>(items: readonly T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function recordPath(
  client: MomentMediaPurgeClient,
  path: PurgeCandidate,
) {
  const { data, error } = await client.rpc("record_moment_media_purge", {
    bucket_id: path.bucket_id,
    object_path: path.object_path,
  });
  if (error) return false;
  const row = Array.isArray(data) ? data.find(isPurgeRecord) : null;
  return row !== null && row !== undefined && recordedReasons.has(row.reason);
}

async function purgeWithClient(client: MomentMediaPurgeClient) {
  const { data, error } = await client.rpc(
    "list_moment_media_purge_candidates",
    { batch_limit: MOMENT_MEDIA_PURGE_MOMENT_LIMIT },
  );
  if (error) {
    console.warn("[moment-media-purge] list_failed", {
      message: error.message,
    });
    throw new Error("Moment media purge is unavailable.");
  }

  const unique = new Map<string, PurgeCandidate>();
  for (const row of Array.isArray(data) ? data : []) {
    if (!isCandidate(row)) continue;
    unique.set(`${row.bucket_id}\n${row.object_path}`, row);
  }

  let purged = 0;
  let retained = 0;
  const byBucket = new Map<MomentMediaBucket, PurgeCandidate[]>();
  for (const path of unique.values()) {
    const group = byBucket.get(path.bucket_id) ?? [];
    group.push(path);
    byBucket.set(path.bucket_id, group);
  }

  for (const [bucket, paths] of byBucket) {
    for (const batch of chunks(paths, MOMENT_MEDIA_PURGE_REMOVE_BATCH)) {
      try {
        const { error: removeError } = await client.storage
          .from(bucket)
          .remove(batch.map((path) => path.object_path));
        // A not-found error means the file is already gone. Any other error
        // leaves the object in place, so this batch waits for the next run.
        if (removeError && !removalErrorIsMissing(removeError)) {
          retained += batch.length;
          continue;
        }
      } catch {
        retained += batch.length;
        continue;
      }

      for (const path of batch) {
        try {
          if (await recordPath(client, path)) purged += 1;
          else retained += 1;
        } catch {
          retained += 1;
        }
      }
    }
  }

  console.info("[moment-media-purge] complete", {
    listed: unique.size,
    purged,
    retained,
  });
  return {
    listed: unique.size,
    purged,
    retained,
  } satisfies MomentMediaPurgeResult;
}

/**
 * Deletes storage bytes for moments trashed more than 30 days ago.
 * The photo validator calls the listing RPC, removes paths in small Storage
 * API batches, and records a purge only after the database confirms the
 * object is gone and no live moment still references that exact path.
 */
export async function runMomentMediaPurge(client?: MomentMediaPurgeClient) {
  if (client) return purgeWithClient(client);
  return withAuthenticatedPhotoWorkerClient((worker) =>
    purgeWithClient(worker as unknown as MomentMediaPurgeClient),
  );
}
