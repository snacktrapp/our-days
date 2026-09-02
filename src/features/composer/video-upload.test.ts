import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import {
  acceptedVideoMime,
  createVideoUploadAttempt,
  maximumVideoBytes,
  uploadVideoMoment,
  type VideoMomentDraft,
  type VideoUploadStage,
} from "./video-upload";

const requestId = "d6000000-0000-4000-8000-000000000011";
const momentId = "d6000000-0000-4000-8000-000000000012";

const draft: VideoMomentDraft = {
  body: "First steps across the kitchen.",
  circleId: "20000000-0000-4000-8000-000000000001",
  durationMs: 12_400,
  journalPersonId: "30000000-0000-4000-8000-000000000001",
  occurredAt: null,
  occurredOn: "2026-09-01",
  occurredTimezone: null,
  placeName: "Home",
  taggedPersonIds: ["30000000-0000-4000-8000-000000000002"],
};

function videoFile(size = 12, type = "video/mp4", name = "family.mp4") {
  return new File([new Uint8Array(size)], name, { type });
}

function connectedClient() {
  const rpc = vi.fn(
    async (name: string): Promise<{ data: unknown; error: unknown }> => {
      if (name === "reserve_video_moment") {
        return {
          data: [
            {
              bucket_id: "our-days-videos",
              moment_id: momentId,
              object_path: `videos/${requestId}`,
              request_id: requestId,
              state: "reserved",
            },
          ],
          error: null,
        };
      }
      return { data: momentId, error: null };
    },
  );
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: {
            access_token: "ordinary-user-token",
            user: { id: "10000000-0000-4000-8000-000000000001" },
          },
        },
        error: null,
      })),
    },
    rpc,
  } as unknown as ReturnType<typeof createOurDaysBrowserClient>;
  return { client, rpc };
}

describe("connected private video upload", () => {
  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_video_test",
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("accepts the basic formats and can infer a missing MIME from the extension", () => {
    expect(acceptedVideoMime(videoFile())).toBe("video/mp4");
    expect(acceptedVideoMime(videoFile(12, "", "family.mov"))).toBe(
      "video/quicktime",
    );
    expect(acceptedVideoMime(videoFile(12, "video/webm", "family.webm"))).toBe(
      "video/webm",
    );
    expect(
      acceptedVideoMime(videoFile(12, "video/avi", "family.avi")),
    ).toBeNull();
  });

  it("reserves an exact private object, transfers it, then finalizes the moment", async () => {
    const file = videoFile();
    const attempt = createVideoUploadAttempt();
    const { client, rpc } = connectedClient();
    const stages: VideoUploadStage[] = [];
    const upload = vi.fn(async (input) => {
      expect(input.endpoint).toBe(
        "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable",
      );
      expect(input.file).toBe(file);
      expect(input.metadata).toMatchObject({
        bucketName: "our-days-videos",
        objectName: `videos/${requestId}`,
        contentType: "video/mp4",
      });
      expect(JSON.parse(input.metadata.metadata)).toEqual({
        duration_ms: draft.durationMs,
        expected_mime_type: "video/mp4",
        expected_size_bytes: file.size,
        request_key: attempt.requestKey,
        video_request_id: requestId,
      });
      await expect(input.session()).resolves.toEqual({
        accessToken: "ordinary-user-token",
      });
      input.saveUploadUrl(
        "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/upload-id",
      );
      input.onStage({ state: "uploading", progress: 1 });
    });

    await expect(
      uploadVideoMoment(
        file,
        draft,
        attempt,
        new AbortController().signal,
        (stage) => stages.push(stage),
        { createClient: () => client, upload },
      ),
    ).resolves.toEqual({ momentId });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "reserve_video_moment",
      expect.objectContaining({
        duration_ms: 12_400,
        expected_mime_type: "video/mp4",
        expected_size_bytes: file.size,
        request_key: attempt.requestKey,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "finalize_video_moment", {
      request_id: requestId,
    });
    expect(attempt).toMatchObject({
      momentId,
      requestId,
      uploadUrl: expect.stringContaining("/upload-id"),
    });
    expect(stages).toEqual([
      { state: "preparing" },
      { state: "uploading", progress: 1 },
      { state: "finishing" },
    ]);
  });

  it("rejects unsupported, oversized, and overlong files before opening a client", async () => {
    const createClient = vi.fn();
    const attempt = createVideoUploadAttempt();
    const run = (file: File, durationMs: number) =>
      uploadVideoMoment(
        file,
        { ...draft, durationMs },
        attempt,
        new AbortController().signal,
        vi.fn(),
        { createClient },
      );

    await expect(
      run(videoFile(12, "video/avi", "family.avi"), 1_000),
    ).rejects.toMatchObject({ retryable: false });
    const oversized = videoFile();
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: maximumVideoBytes + 1,
    });
    await expect(run(oversized, 1_000)).rejects.toThrow("smaller than 100 MB");
    await expect(run(videoFile(), 60_501)).rejects.toThrow(
      "60 seconds or shorter",
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});
