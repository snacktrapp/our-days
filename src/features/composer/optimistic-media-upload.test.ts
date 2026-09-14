import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const photoUpload = vi.hoisted(() => ({
  upload: vi.fn(),
}));
const videoUpload = vi.hoisted(() => ({
  upload: vi.fn(),
}));
const videoInspect = vi.hoisted(() => ({
  inspect: vi.fn(),
}));

vi.mock("./photo-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./photo-upload")>()),
  uploadPhotoMoment: photoUpload.upload,
}));
vi.mock("./video-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./video-upload")>()),
  uploadVideoMoment: videoUpload.upload,
}));
vi.mock("@/features/video/inspect-video-file", () => ({
  inspectVideoFile: videoInspect.inspect,
}));

import { PhotoUploadError } from "./photo-upload";
import {
  clearOptimisticMediaUploads,
  optimisticMediaUploadSnapshot,
  queuedOptimisticMediaUploadCount,
  removeOptimisticMediaUpload,
  retryOptimisticMediaUpload,
  startOptimisticPhotoUpload,
  startOptimisticVideoUpload,
} from "./optimistic-media-upload";

const person = {
  id: "person-1",
  name: "Brian",
  initial: "B",
  accent: "teal" as const,
};

const draft = {
  body: "Porch light",
  circleId: "20000000-0000-4000-8000-000000000001",
  journalPersonId: person.id,
  occurredAt: "2026-09-01T14:58:00.000Z",
  occurredOn: "2026-09-01",
  occurredTimezone: "America/Chicago",
  placeName: "",
  taggedPersonIds: [],
};
const otherCircleId = "20000000-0000-4000-8000-000000000002";

function jpeg(name: string) {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, {
    type: "image/jpeg",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearOptimisticMediaUploads();
});

afterEach(() => {
  clearOptimisticMediaUploads();
});

describe("optimistic media upload queue", () => {
  it("queues a second photo moment instead of starting a competing upload", async () => {
    photoUpload.upload.mockReturnValue(new Promise(() => undefined));
    startOptimisticPhotoUpload({
      draft,
      file: jpeg("one.jpg"),
      occurredTime: "14:58",
      person,
    });
    startOptimisticPhotoUpload({
      draft: { ...draft, body: "Second" },
      file: jpeg("two.jpg"),
      occurredTime: "15:01",
      person,
    });

    expect(optimisticMediaUploadSnapshot()).toHaveLength(1);
    expect(optimisticMediaUploadSnapshot()[0]).toEqual(
      expect.objectContaining({ body: "Porch light" }),
    );
    expect(queuedOptimisticMediaUploadCount()).toBe(1);
    expect(queuedOptimisticMediaUploadCount(draft.circleId)).toBe(1);
    expect(photoUpload.upload).toHaveBeenCalledOnce();
  });

  it("counts queued uploads by circle", async () => {
    photoUpload.upload.mockReturnValue(new Promise(() => undefined));
    startOptimisticPhotoUpload({
      draft,
      file: jpeg("one.jpg"),
      occurredTime: "14:58",
      person,
    });
    startOptimisticPhotoUpload({
      draft: { ...draft, body: "Second in same circle" },
      file: jpeg("two.jpg"),
      occurredTime: "15:01",
      person,
    });
    startOptimisticPhotoUpload({
      draft: {
        ...draft,
        circleId: otherCircleId,
        body: "Queued in another circle",
      },
      file: jpeg("three.jpg"),
      occurredTime: "15:05",
      person,
    });

    expect(queuedOptimisticMediaUploadCount()).toBe(2);
    expect(queuedOptimisticMediaUploadCount(draft.circleId)).toBe(1);
    expect(queuedOptimisticMediaUploadCount(otherCircleId)).toBe(1);
  });

  it("starts the next post as a visible chip when a failed upload is still showing", async () => {
    photoUpload.upload
      .mockRejectedValueOnce(new PhotoUploadError("Session expired.", false))
      .mockReturnValueOnce(new Promise(() => undefined));

    startOptimisticPhotoUpload({
      draft,
      file: jpeg("failed.jpg"),
      occurredTime: "14:58",
      person,
    });
    await vi.waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "failed",
        message: "Session expired.",
      }),
    );

    startOptimisticPhotoUpload({
      draft: { ...draft, body: "Second porch" },
      file: jpeg("next.jpg"),
      occurredTime: "15:01",
      person,
    });

    expect(queuedOptimisticMediaUploadCount()).toBe(0);
    expect(optimisticMediaUploadSnapshot()).toHaveLength(2);
    expect(optimisticMediaUploadSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: "Porch light",
          stage: { state: "failed", message: "Session expired." },
        }),
        expect.objectContaining({
          body: "Second porch",
          stage: { state: "preparing" },
        }),
      ]),
    );
    expect(photoUpload.upload).toHaveBeenCalledTimes(2);
  });

  it("drops a queued follow-up instead of posting it after a failed chip is dismissed", async () => {
    let rejectFirst: (error: unknown) => void = () => {
      throw new Error("The in-flight upload was not started.");
    };
    photoUpload.upload.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    startOptimisticPhotoUpload({
      draft,
      file: jpeg("one.jpg"),
      occurredTime: "14:58",
      person,
    });
    startOptimisticPhotoUpload({
      draft: { ...draft, body: "Queued behind in-flight" },
      file: jpeg("two.jpg"),
      occurredTime: "15:01",
      person,
    });
    expect(queuedOptimisticMediaUploadCount()).toBe(1);
    expect(photoUpload.upload).toHaveBeenCalledOnce();

    rejectFirst(new PhotoUploadError("Stopped mid-upload.", true));
    await vi.waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "failed",
        message: "Stopped mid-upload.",
      }),
    );
    expect(queuedOptimisticMediaUploadCount()).toBe(0);

    removeOptimisticMediaUpload(optimisticMediaUploadSnapshot()[0]!.id);
    expect(queuedOptimisticMediaUploadCount()).toBe(0);
    expect(optimisticMediaUploadSnapshot()).toEqual([]);
    expect(photoUpload.upload).toHaveBeenCalledOnce();
  });

  it("retries remaining photos after a failed chip action", async () => {
    photoUpload.upload
      .mockResolvedValueOnce({
        state: "processing",
        intakeId: "d6000000-0000-4000-8000-000000000001",
        momentId: "d6000000-0000-4000-8000-000000000002",
      })
      .mockRejectedValueOnce(new PhotoUploadError("Stopped mid-album.", true))
      .mockResolvedValueOnce({
        state: "processing",
        intakeId: "d6000000-0000-4000-8000-000000000003",
        momentId: "d6000000-0000-4000-8000-000000000002",
      });

    const first = jpeg("one.jpg");
    const second = jpeg("two.jpg");
    startOptimisticPhotoUpload({
      draft,
      file: first,
      files: [first, second],
      occurredTime: "14:58",
      person,
    });

    await vi.waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "failed",
        message: "Stopped mid-album.",
      }),
    );
    expect(optimisticMediaUploadSnapshot()[0]).toEqual(
      expect.objectContaining({
        completedFiles: 1,
        momentId: "d6000000-0000-4000-8000-000000000002",
      }),
    );

    expect(
      retryOptimisticMediaUpload(optimisticMediaUploadSnapshot()[0]!.id),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "processing",
      }),
    );
    expect(photoUpload.upload).toHaveBeenCalledTimes(3);
    expect(photoUpload.upload).toHaveBeenLastCalledWith(
      second,
      expect.objectContaining({
        existingMomentId: "d6000000-0000-4000-8000-000000000002",
        announcePublication: false,
      }),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("announces only the first photo of a new multi-photo post", async () => {
    const momentId = "d6000000-0000-4000-8000-000000000002";
    photoUpload.upload.mockImplementation(async (_file, nextDraft) => ({
      state: "published" as const,
      intakeId: "d6000000-0000-4000-8000-000000000001",
      momentId: nextDraft.existingMomentId ?? momentId,
    }));
    const files = [jpeg("one.jpg"), jpeg("two.jpg"), jpeg("three.jpg")];
    startOptimisticPhotoUpload({
      draft,
      file: files[0]!,
      files,
      occurredTime: "14:58",
      person,
    });
    await vi.waitFor(() => expect(photoUpload.upload).toHaveBeenCalledTimes(3));
    expect(
      photoUpload.upload.mock.calls.map(([, nextDraft]) => nextDraft),
    ).toEqual([
      expect.objectContaining({
        announcePublication: true,
        existingMomentId: undefined,
      }),
      expect.objectContaining({
        announcePublication: false,
        existingMomentId: momentId,
      }),
      expect.objectContaining({
        announcePublication: false,
        existingMomentId: momentId,
      }),
    ]);
  });

  it("announces only the first photo when an edit adds several", async () => {
    const existingMomentId = "d6000000-0000-4000-8000-000000000009";
    photoUpload.upload.mockResolvedValue({
      state: "published",
      intakeId: "d6000000-0000-4000-8000-000000000001",
      momentId: existingMomentId,
    });
    const files = [
      jpeg("four.jpg"),
      jpeg("five.jpg"),
      jpeg("six.jpg"),
      jpeg("seven.jpg"),
    ];
    startOptimisticPhotoUpload({
      draft: { ...draft, existingMomentId },
      file: files[0]!,
      files,
      occurredTime: "14:58",
      person,
    });
    await vi.waitFor(() => expect(photoUpload.upload).toHaveBeenCalledTimes(4));
    expect(
      photoUpload.upload.mock.calls.map(([, nextDraft]) => nextDraft),
    ).toEqual([
      expect.objectContaining({
        announcePublication: true,
        existingMomentId,
      }),
      expect.objectContaining({
        announcePublication: false,
        existingMomentId,
      }),
      expect.objectContaining({
        announcePublication: false,
        existingMomentId,
      }),
      expect.objectContaining({
        announcePublication: false,
        existingMomentId,
      }),
    ]);
  });

  it("inspects a video after Save when duration is not ready yet", async () => {
    videoInspect.inspect.mockResolvedValue({
      durationMs: 8_000,
      width: 1280,
      height: 720,
      posterDataUrl: "data:image/jpeg;base64,abc",
    });
    videoUpload.upload.mockResolvedValue({
      momentId: "d6000000-0000-4000-8000-000000000014",
    });
    const file = new File([new Uint8Array(24)], "wave.mp4", {
      type: "video/mp4",
    });

    startOptimisticVideoUpload({
      draft: { ...draft, durationMs: undefined },
      file,
      occurredTime: "14:58",
      person,
    });

    expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
      state: "preparing",
    });
    await vi.waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "published",
      }),
    );
    expect(videoInspect.inspect).toHaveBeenCalledWith(
      file,
      expect.any(AbortSignal),
    );
    expect(videoUpload.upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ durationMs: 8_000 }),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({
        dataUrl: expect.stringContaining("data:image/jpeg"),
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
  });
});
