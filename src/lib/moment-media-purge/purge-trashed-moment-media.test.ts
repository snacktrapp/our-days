// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/photo-worker.server", () => ({
  withAuthenticatedPhotoWorkerClient: vi.fn(),
}));

import { MOMENT_MEDIA_PURGE_REMOVE_BATCH } from "./constants";
import {
  runMomentMediaPurge,
  type MomentMediaPurgeClient,
} from "./purge-trashed-moment-media";

const oldVideo = {
  moment_id: "e1100000-0000-4000-8000-000000000001",
  bucket_id: "our-days-videos",
  object_path: "video/e1100000-0000-4000-8000-000000000002",
};
const oldPoster = {
  moment_id: "e1100000-0000-4000-8000-000000000001",
  bucket_id: "our-days-videos",
  object_path: "poster/e1100000-0000-4000-8000-000000000001",
};

function client(options: {
  listed?: unknown;
  listError?: string;
  remove?: (
    bucket: string,
    paths: string[],
  ) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  record?: (
    bucket: string,
    objectPath: string,
  ) => { recorded: boolean; reason: string };
}) {
  const remove = vi.fn(
    options.remove ??
      (async () => ({
        data: [],
        error: null,
      })),
  );
  const record = vi.fn(
    options.record ??
      (() => ({
        recorded: true,
        reason: "purged",
      })),
  );
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === "list_moment_media_purge_candidates") {
      return {
        data: options.listed ?? [oldVideo],
        error: options.listError ? { message: options.listError } : null,
      };
    }
    if (fn === "record_moment_media_purge") {
      return {
        data: [record(String(args?.bucket_id), String(args?.object_path))],
        error: null,
      };
    }
    return { data: null, error: { message: `unexpected ${fn}` } };
  });
  const purgeClient: MomentMediaPurgeClient = {
    rpc,
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => remove(bucket, paths),
      }),
    },
  };
  return { purgeClient, remove, record };
}

describe("trashed moment media purge", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("records a missing file as purged", async () => {
    const { purgeClient, remove, record } = client({});
    await expect(runMomentMediaPurge(purgeClient)).resolves.toEqual({
      listed: 1,
      purged: 1,
      retained: 0,
    });
    expect(remove).toHaveBeenCalledWith("our-days-videos", [
      oldVideo.object_path,
    ]);
    expect(record).toHaveBeenCalledWith(
      "our-days-videos",
      oldVideo.object_path,
    );
  });

  it("treats a not-found removal error as a chance to record the purge", async () => {
    const { purgeClient, record } = client({
      remove: async () => ({
        data: null,
        error: { message: "Object not found" },
      }),
    });
    await expect(runMomentMediaPurge(purgeClient)).resolves.toEqual({
      listed: 1,
      purged: 1,
      retained: 0,
    });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("keeps a path that the database says is still present", async () => {
    const { purgeClient } = client({
      listed: [oldVideo, oldPoster],
      record: (_bucket, objectPath) =>
        objectPath === oldPoster.object_path
          ? { recorded: false, reason: "still_present" }
          : { recorded: true, reason: "purged" },
    });
    await expect(runMomentMediaPurge(purgeClient)).resolves.toEqual({
      listed: 2,
      purged: 1,
      retained: 1,
    });
  });

  it("does not record a batch when storage removal fails", async () => {
    const { purgeClient, record } = client({
      remove: async () => ({
        data: null,
        error: { message: "permission denied" },
      }),
    });
    await expect(runMomentMediaPurge(purgeClient)).resolves.toEqual({
      listed: 1,
      purged: 0,
      retained: 1,
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("removes one bucket in small batches and dedupes a shared path", async () => {
    const paths = Array.from(
      { length: MOMENT_MEDIA_PURGE_REMOVE_BATCH + 1 },
      (_, index) => ({
        moment_id: `moment-${index}`,
        bucket_id: "our-days-display" as const,
        object_path: `display/path-${index}.webp`,
      }),
    );
    const { purgeClient, remove } = client({
      listed: [paths[0], paths[0], ...paths.slice(1)],
    });
    const result = await runMomentMediaPurge(purgeClient);
    expect(result.listed).toBe(MOMENT_MEDIA_PURGE_REMOVE_BATCH + 1);
    expect(result.purged).toBe(MOMENT_MEDIA_PURGE_REMOVE_BATCH + 1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls[0]?.[1]).toHaveLength(
      MOMENT_MEDIA_PURGE_REMOVE_BATCH,
    );
    expect(remove.mock.calls[1]?.[1]).toHaveLength(1);
  });

  it("fails closed when the listing RPC fails", async () => {
    const { purgeClient, remove } = client({
      listError: "validator session ended",
    });
    await expect(runMomentMediaPurge(purgeClient)).rejects.toThrow(
      "Moment media purge is unavailable.",
    );
    expect(remove).not.toHaveBeenCalled();
  });
});
