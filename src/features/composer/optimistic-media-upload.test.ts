import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const photoUpload = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock("./photo-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./photo-upload")>()),
  uploadPhotoMoment: photoUpload.upload,
}));

import { PhotoUploadError } from "./photo-upload";
import {
  clearOptimisticMediaUploads,
  optimisticMediaUploadSnapshot,
  queuedOptimisticMediaUploadCount,
  retryOptimisticMediaUpload,
  startOptimisticPhotoUpload,
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
      }),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });
});
