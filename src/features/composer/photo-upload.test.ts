import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import type { PhotoUploadResumeRecord } from "./photo-upload-resume-store";
import {
  createPhotoUploadAttempt,
  detectedPhotoMime,
  PhotoUploadError,
  uploadPhotoMoment,
  type PhotoMomentDraft,
  type PhotoUploadStage,
} from "./photo-upload";

const intakeId = "d6000000-0000-4000-8000-000000000001";
const momentId = "d6000000-0000-4000-8000-000000000002";
const uploadUrl =
  "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/upload-id";
const sixMiB = 6 * 1024 * 1024;

const draft: PhotoMomentDraft = {
  body: "A quiet afternoon.",
  circleId: "20000000-0000-4000-8000-000000000001",
  journalPersonId: "30000000-0000-4000-8000-000000000001",
  occurredAt: null,
  occurredOn: "2026-08-30",
  occurredTimezone: null,
  placeName: "Back garden",
  taggedPersonIds: ["30000000-0000-4000-8000-000000000002"],
};

function jpegFile(size = 12) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return new File([bytes], "private-name.jpg", { type: "image/jpeg" });
}

function clientWithStatus(status = "published") {
  const calls: string[] = [];
  const rpc = vi.fn(
    async (name: string): Promise<{ data: unknown; error: unknown }> => {
      calls.push(name);
      if (name === "attach_photo_to_moment") {
        return {
          data: [
            {
              bucket_id: "our-days-intake",
              expires_at: "2026-08-31T20:00:00Z",
              intake_id: intakeId,
              moment_id: momentId,
              object_path: `intake/${intakeId}`,
              state: "reserved",
            },
          ],
          error: null,
        };
      }
      if (name === "reserve_photo_moment") {
        return {
          data: [
            {
              bucket_id: "our-days-intake",
              expires_at: "2026-08-31T20:00:00Z",
              intake_id: intakeId,
              moment_id: momentId,
              object_path: `intake/${intakeId}`,
              state: "reserved",
            },
          ],
          error: null,
        };
      }
      if (name === "claim_photo_intake_upload") {
        return {
          data: [
            {
              bucket_id: "our-days-intake",
              intake_id: intakeId,
              object_path: `intake/${intakeId}`,
              state: "upload_claimed",
              upload_expires_at: "2026-08-31T20:00:00Z",
            },
          ],
          error: null,
        };
      }
      if (name === "acknowledge_photo_intake") {
        return { data: [], error: null };
      }
      if (name === "cancel_photo_intake") {
        return {
          data: [
            {
              cleanup_state: "queued",
              intake_id: intakeId,
              state: "invalidated",
            },
          ],
          error: null,
        };
      }
      return {
        data: [{ moment_id: status === "published" ? momentId : null, status }],
        error: null,
      };
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
  return { calls, client, rpc };
}

function memoryResumeStore(initial: PhotoUploadResumeRecord | null = null) {
  let record: PhotoUploadResumeRecord | null = initial;
  return {
    find: vi.fn(async () => record),
    listForScope: vi.fn(async () => (record ? [record] : [])),
    save: vi.fn(async (next: PhotoUploadResumeRecord) => {
      record = next;
    }),
    remove: vi.fn(async () => {
      record = null;
    }),
  };
}

describe("connected private photo upload", () => {
  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_photo_test",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, momentId }, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("classifies supported bytes rather than trusting a picker MIME hint", async () => {
    expect(await detectedPhotoMime(jpegFile())).toBe("image/jpeg");
    expect(
      await detectedPhotoMime(
        new File(
          [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
          "photo",
        ),
      ),
    ).toBe("image/png");
    expect(
      await detectedPhotoMime(
        new File([new TextEncoder().encode("RIFFxxxxWEBP")], "photo.webp", {
          type: "image/webp",
        }),
      ),
    ).toBe("image/webp");
  });

  it("uses stable keys, exact RPC order, direct Storage TUS, and 6 MiB chunks", async () => {
    const file = jpegFile(sixMiB + 7);
    const attempt = createPhotoUploadAttempt();
    const { calls, client, rpc } = clientWithStatus();
    const resumeStore = memoryResumeStore();
    const stages: PhotoUploadStage[] = [];
    let offset = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": String(offset) },
          });
        }
        const body = init?.body as Blob;
        offset += body.size;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset) },
        });
      },
    );

    const result = await uploadPhotoMoment(
      file,
      draft,
      attempt,
      new AbortController().signal,
      (stage) => stages.push(stage),
      {
        createClient: () => client,
        fetch: fetcher,
        hash: vi.fn(async () => "a".repeat(64)),
        resumeStore,
        statusAttempts: 1,
      },
    );

    expect(result).toEqual({ state: "published", intakeId, momentId });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/photos/process",
      expect.objectContaining({
        body: JSON.stringify({ intakeId }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(calls).toEqual([
      "reserve_photo_moment",
      "claim_photo_intake_upload",
      "acknowledge_photo_intake",
      "get_photo_moment_status",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "reserve_photo_moment",
      expect.objectContaining({ request_key: attempt.requestKey }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "claim_photo_intake_upload",
      expect.objectContaining({ upload_request_key: attempt.uploadRequestKey }),
    );
    const postCall = fetcher.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(String(postCall?.[0])).toBe(
      "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable",
    );
    expect(postCall?.[1]?.headers).toMatchObject({
      authorization: "Bearer ordinary-user-token",
      "upload-length": String(file.size),
      "x-upsert": "false",
    });
    const serializedHeaders = JSON.stringify(postCall?.[1]?.headers);
    expect(serializedHeaders).not.toContain(file.name);
    expect(serializedHeaders).not.toContain(draft.body);
    expect(serializedHeaders).not.toContain(draft.placeName);
    const serializedResumeRecords = JSON.stringify(resumeStore.save.mock.calls);
    expect(serializedResumeRecords).not.toContain(file.name);
    expect(serializedResumeRecords).not.toContain(draft.body);
    expect(serializedResumeRecords).not.toContain(draft.placeName);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(2);
    expect(stages.at(-1)).toEqual({ state: "processing" });
    expect(stages.slice(-2)).toEqual([
      { state: "finishing" },
      { state: "processing" },
    ]);
    expect(
      stages
        .filter(
          (stage): stage is Extract<PhotoUploadStage, { state: "uploading" }> =>
            stage.state === "uploading",
        )
        .map((stage) => stage.progress),
    ).toEqual([0, sixMiB / file.size, 1]);
  });

  it("attaches a later photo to an existing moment instead of reserving a new one", async () => {
    const file = jpegFile();
    const { calls, client, rpc } = clientWithStatus();
    const result = await uploadPhotoMoment(
      file,
      { ...draft, existingMomentId: momentId },
      createPhotoUploadAttempt(),
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => client,
        fetch: vi.fn(async (_input, init) => {
          if (init?.method === "POST") {
            return new Response(null, {
              status: 201,
              headers: { location: uploadUrl },
            });
          }
          if (init?.method === "HEAD") {
            return new Response(null, {
              status: 200,
              headers: { "upload-offset": "0" },
            });
          }
          return new Response(null, {
            status: 204,
            headers: { "upload-offset": String(file.size) },
          });
        }),
        hash: vi.fn(async () => "a".repeat(64)),
        resumeStore: memoryResumeStore(),
        statusAttempts: 1,
      },
    );
    expect(result.momentId).toBe(momentId);
    expect(calls[0]).toBe("attach_photo_to_moment");
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "attach_photo_to_moment",
      expect.objectContaining({
        existing_moment_id: momentId,
      }),
    );
    expect(calls).not.toContain("reserve_photo_moment");
  });

  it("uses the Safari-safe TUS transport in the production path", async () => {
    const { client } = clientWithStatus();
    const upload = vi.fn(async (input) => {
      expect(input.endpoint).toBe(
        "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable",
      );
      expect(input.metadata).toMatchObject({
        bucketName: "our-days-intake",
        contentType: "image/jpeg",
        objectName: `intake/${intakeId}`,
      });
      expect(await input.session()).toEqual({
        accessToken: "ordinary-user-token",
      });
      input.onStage({ state: "uploading", progress: 1 });
      await input.saveUploadUrl(uploadUrl);
    });
    const attempt = createPhotoUploadAttempt();

    const result = await uploadPhotoMoment(
      jpegFile(),
      draft,
      attempt,
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => client,
        hash: vi.fn(async () => "1".repeat(64)),
        resumeStore: memoryResumeStore(),
        statusAttempts: 1,
        upload,
      },
    );

    expect(result.state).toBe("published");
    expect(upload).toHaveBeenCalledOnce();
    expect(attempt.uploadUrl).toBe(uploadUrl);
  });

  it("resumes the same TUS URL after an ambiguous chunk failure", async () => {
    const file = jpegFile(sixMiB + 3);
    const attempt = createPhotoUploadAttempt();
    const { client } = clientWithStatus();
    const resumeStore = memoryResumeStore();
    let offset = 0;
    let failedOnce = false;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": String(offset) },
          });
        }
        const requestedOffset = Number(
          (init?.headers as Record<string, string>)["upload-offset"],
        );
        const body = init?.body as Blob;
        if (!failedOnce) {
          failedOnce = true;
          offset = requestedOffset + body.size;
          throw new TypeError("lost response");
        }
        offset = requestedOffset + body.size;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset) },
        });
      },
    );

    await uploadPhotoMoment(
      file,
      draft,
      attempt,
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => client,
        fetch: fetcher,
        hash: vi.fn(async () => "b".repeat(64)),
        pause: vi.fn(async () => undefined),
        resumeStore,
        statusAttempts: 1,
      },
    );

    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(attempt.uploadUrl).toBe(uploadUrl);
    expect(offset).toBe(file.size);
  });

  it("rejects HEIC and MIME-confused bytes before creating a client", async () => {
    const createClient = vi.fn();
    const unsupported = new File(
      [new TextEncoder().encode("....ftypheic")],
      "iphone.heic",
      { type: "image/heic" },
    );
    await expect(
      uploadPhotoMoment(
        unsupported,
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        { createClient },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PhotoUploadError>>({
        message: "For now, choose a JPEG, PNG, or WebP photo.",
        retryable: false,
      }),
    );

    const confused = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0x00])],
      "confused.png",
      { type: "image/png" },
    );
    await expect(
      uploadPhotoMoment(
        confused,
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        { createClient },
      ),
    ).rejects.toThrow("file type does not match");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a persisted upload URL from any other origin before sending a token", async () => {
    const { client } = clientWithStatus();
    const fetcher = vi.fn();
    const resumeStore = memoryResumeStore({
      id: "resume-id",
      accountId: "10000000-0000-4000-8000-000000000001",
      acknowledged: false,
      circleId: draft.circleId,
      draftHash: "ignored-by-test-store",
      fileSha256: "e".repeat(64),
      fileSize: 12,
      mimeType: "image/jpeg",
      requestKey: "d7000000-0000-4000-8000-000000000001",
      uploadRequestKey: "d7000000-0000-4000-8000-000000000002",
      uploadUrl: "https://attacker.example/upload/private",
    });

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        {
          createClient: () => client,
          fetch: fetcher,
          hash: vi.fn(async () => "e".repeat(64)),
          resumeStore,
        },
      ),
    ).rejects.toThrow("unsafe destination");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a same-origin persisted URL outside the resumable upload path", async () => {
    const { client } = clientWithStatus();
    const fetcher = vi.fn();
    const resumeStore = memoryResumeStore({
      id: "resume-id",
      accountId: "10000000-0000-4000-8000-000000000001",
      acknowledged: false,
      circleId: draft.circleId,
      draftHash: "ignored-by-test-store",
      fileSha256: "e".repeat(64),
      fileSize: 12,
      mimeType: "image/jpeg",
      requestKey: "d7000000-0000-4000-8000-000000000001",
      uploadRequestKey: "d7000000-0000-4000-8000-000000000002",
      uploadUrl:
        "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/auth/v1/callback",
    });

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        {
          createClient: () => client,
          fetch: fetcher,
          hash: vi.fn(async () => "e".repeat(64)),
          resumeStore,
        },
      ),
    ).rejects.toThrow("unsafe destination");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops after a coordinator RPC before beginning the next phase", async () => {
    const { client, calls, rpc } = clientWithStatus();
    const originalRpc = rpc.getMockImplementation();
    let releaseClaim: () => void = () => {
      throw new Error("Claim did not start.");
    };
    let claimStarted = false;
    rpc.mockImplementation(async (...arguments_) => {
      if (arguments_[0] === "claim_photo_intake_upload") {
        claimStarted = true;
        await new Promise<void>((resolve) => {
          releaseClaim = resolve;
        });
      }
      return originalRpc!(...arguments_);
    });
    const controller = new AbortController();
    const fetcher = vi.fn();
    const upload = uploadPhotoMoment(
      jpegFile(),
      draft,
      createPhotoUploadAttempt(),
      controller.signal,
      () => undefined,
      {
        createClient: () => client,
        fetch: fetcher,
        hash: vi.fn(async () => "f".repeat(64)),
        resumeStore: memoryResumeStore(),
      },
    );
    await vi.waitFor(() => expect(claimStarted).toBe(true));
    controller.abort();
    releaseClaim();

    await expect(upload).rejects.toEqual(
      expect.objectContaining<Partial<PhotoUploadError>>({
        message:
          "Upload stopped. This photo won’t be added. Private removal is finishing.",
        retryable: true,
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(calls).toContain("cancel_photo_intake");
    expect(calls).not.toContain("acknowledge_photo_intake");
  });

  it("does not claim cancellation when the server cannot confirm it", async () => {
    const { client, rpc } = clientWithStatus();
    const originalRpc = rpc.getMockImplementation();
    let releaseClaim: () => void = () => {
      throw new Error("Claim did not start.");
    };
    rpc.mockImplementation(async (...arguments_) => {
      if (arguments_[0] === "claim_photo_intake_upload") {
        await new Promise<void>((resolve) => {
          releaseClaim = resolve;
        });
      }
      if (arguments_[0] === "cancel_photo_intake") {
        return { data: null, error: { message: "offline" } };
      }
      return originalRpc!(...arguments_);
    });
    const resumeStore = memoryResumeStore();
    const controller = new AbortController();
    const upload = uploadPhotoMoment(
      jpegFile(),
      draft,
      createPhotoUploadAttempt(),
      controller.signal,
      () => undefined,
      {
        createClient: () => client,
        fetch: vi.fn(),
        hash: vi.fn(async () => "6".repeat(64)),
        resumeStore,
      },
    );
    await vi.waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "claim_photo_intake_upload",
        expect.any(Object),
      ),
    );
    controller.abort();
    releaseClaim();

    await expect(upload).rejects.toEqual(
      expect.objectContaining<Partial<PhotoUploadError>>({
        message:
          "The transfer stopped on this device, but cancellation could not be confirmed. Review unfinished photos before trying again.",
        retryable: false,
      }),
    );
    expect(resumeStore.remove).not.toHaveBeenCalled();
  });

  it("maps quota failures and retires a reservation rejected at claim", async () => {
    const { client, rpc } = clientWithStatus();
    const originalRpc = rpc.getMockImplementation();
    rpc.mockImplementation(async (...arguments_) => {
      if (arguments_[0] === "claim_photo_intake_upload") {
        return {
          data: null,
          error: { message: "PHOTO_ACCOUNT_BYTE_QUOTA" },
        };
      }
      return originalRpc!(...arguments_);
    });
    const resumeStore = memoryResumeStore();
    const attempt = createPhotoUploadAttempt();
    const originalRequestKey = attempt.requestKey;

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        attempt,
        new AbortController().signal,
        () => undefined,
        {
          createClient: () => client,
          fetch: vi.fn(),
          hash: vi.fn(async () => "5".repeat(64)),
          resumeStore,
        },
      ),
    ).rejects.toThrow(
      "Private removal is still finishing for earlier uploads. Review unfinished photos before trying again.",
    );
    expect(rpc).toHaveBeenCalledWith("cancel_photo_intake", {
      intake_id: intakeId,
    });
    expect(resumeStore.remove).toHaveBeenCalledTimes(1);
    expect(attempt.requestKey).not.toBe(originalRequestKey);
    expect(attempt.intakeId).toBeUndefined();
  });

  it("bounds repeated ambiguous PATCH failures with delayed retries", async () => {
    const { client } = clientWithStatus();
    const pause = vi.fn(async (_milliseconds: number, _signal: AbortSignal) => {
      void _milliseconds;
      void _signal;
    });
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": "0" },
          });
        }
        throw new TypeError("network unavailable");
      },
    );

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        {
          createClient: () => client,
          fetch: fetcher,
          hash: vi.fn(async () => "9".repeat(64)),
          pause,
          resumeStore: memoryResumeStore(),
        },
      ),
    ).rejects.toThrow("kept losing its connection");
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(5);
    expect(pause).toHaveBeenCalledTimes(4);
    expect(
      pause.mock.calls.every(
        ([milliseconds]) => milliseconds >= 250 && milliseconds <= 2_100,
      ),
    ).toBe(true);
  });

  it("discards an expired TUS URL so the same photo can start fresh", async () => {
    const expiredResume: PhotoUploadResumeRecord = {
      id: "expired-resume",
      accountId: "10000000-0000-4000-8000-000000000001",
      acknowledged: false,
      circleId: draft.circleId,
      draftHash: "ignored-by-test-store",
      fileSha256: "7".repeat(64),
      fileSize: 12,
      mimeType: "image/jpeg",
      requestKey: "d7000000-0000-4000-8000-000000000003",
      uploadRequestKey: "d7000000-0000-4000-8000-000000000004",
      uploadUrl,
    };
    const resumeStore = memoryResumeStore(expiredResume);
    const expiredFetcher = vi.fn(
      async () => new Response(null, { status: 410 }),
    );
    const expiredAttempt = createPhotoUploadAttempt();
    const expiredRequestKey = expiredAttempt.requestKey;

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        expiredAttempt,
        new AbortController().signal,
        () => undefined,
        {
          createClient: () => clientWithStatus().client,
          fetch: expiredFetcher,
          hash: vi.fn(async () => "7".repeat(64)),
          resumeStore,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PhotoUploadError>>({
        discardResume: true,
        retryable: true,
      }),
    );
    expect(resumeStore.remove).toHaveBeenCalledWith(expiredResume.id);
    expect(expiredAttempt.uploadUrl).toBeUndefined();
    expect(expiredAttempt.requestKey).not.toBe(expiredRequestKey);
    expect(expiredAttempt.requestKey).not.toBe(expiredResume.requestKey);

    let offset = 0;
    const freshFetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": String(offset) },
          });
        }
        offset += (init?.body as Blob).size;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset) },
        });
      },
    );
    await uploadPhotoMoment(
      jpegFile(),
      draft,
      expiredAttempt,
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => clientWithStatus().client,
        fetch: freshFetcher,
        hash: vi.fn(async () => "7".repeat(64)),
        resumeStore,
        statusAttempts: 1,
      },
    );

    expect(
      freshFetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(expiredAttempt.uploadUrl).toBe(uploadUrl);
  });

  it("reports processing honestly when publication has not completed", async () => {
    const { client } = clientWithStatus("processing");
    const resumeStore = memoryResumeStore();
    let offset = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": String(offset) },
          });
        }
        offset += (init?.body as Blob).size;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset) },
        });
      },
    );
    const result = await uploadPhotoMoment(
      jpegFile(),
      draft,
      createPhotoUploadAttempt(),
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => client,
        fetch: fetcher,
        hash: vi.fn(async () => "c".repeat(64)),
        resumeStore,
        statusAttempts: 1,
      },
    );
    expect(result.state).toBe("processing");
  });

  it("retires an acknowledged needs-attention record so a retry starts fresh", async () => {
    const { client } = clientWithStatus("needs_attention");
    const resumeStore = memoryResumeStore();
    let offset = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": String(offset) },
          });
        }
        offset += (init?.body as Blob).size;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset) },
        });
      },
    );

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        {
          createClient: () => client,
          fetch: fetcher,
          hash: vi.fn(async () => "e".repeat(64)),
          resumeStore,
          statusAttempts: 1,
        },
      ),
    ).rejects.toMatchObject({ discardResume: true, retryable: true });
    expect(resumeStore.remove).toHaveBeenCalledOnce();
    expect(resumeStore.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ acknowledged: true, intakeId, momentId }),
    );
  });

  it("drops a terminal acknowledged resume before reserving a fresh intake", async () => {
    const staleResume: PhotoUploadResumeRecord = {
      id: "terminal-resume",
      accountId: "10000000-0000-4000-8000-000000000001",
      acknowledged: true,
      circleId: draft.circleId,
      draftHash: "ignored-by-test-store",
      fileSha256: "f".repeat(64),
      fileSize: 12,
      mimeType: "image/jpeg",
      requestKey: "d7000000-0000-4000-8000-000000000005",
      uploadRequestKey: "d7000000-0000-4000-8000-000000000006",
      intakeId,
      momentId,
      uploadUrl,
    };
    const resumeStore = memoryResumeStore(staleResume);
    const { client, rpc } = clientWithStatus("published");
    const implementation = rpc.getMockImplementation();
    let statusReads = 0;
    rpc.mockImplementation(async (name: string, args?: unknown) => {
      if (name === "get_photo_moment_status") {
        statusReads += 1;
        if (statusReads === 1) {
          return {
            data: [{ moment_id: null, status: "needs_attention" }],
            error: null,
          };
        }
      }
      void args;
      return implementation!(name);
    });
    const attempt = createPhotoUploadAttempt();

    const result = await uploadPhotoMoment(
      jpegFile(),
      draft,
      attempt,
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => client,
        hash: vi.fn(async () => "f".repeat(64)),
        resumeStore,
        statusAttempts: 1,
        upload: vi.fn(async (input) => {
          await input.saveUploadUrl(uploadUrl);
        }),
      },
    );

    expect(result.state).toBe("published");
    expect(resumeStore.remove).toHaveBeenCalledWith(staleResume.id);
    expect(attempt.requestKey).not.toBe(staleResume.requestKey);
    expect(rpc).not.toHaveBeenCalledWith(
      "cancel_photo_intake",
      expect.anything(),
    );
  });

  it("recovers stable keys and the same upload URL after file reselection", async () => {
    const file = jpegFile();
    const resumeStore = memoryResumeStore();
    const firstAttempt = createPhotoUploadAttempt();
    const firstKeys = {
      requestKey: firstAttempt.requestKey,
      uploadRequestKey: firstAttempt.uploadRequestKey,
    };
    let offset = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { location: uploadUrl },
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": String(offset) },
          });
        }
        offset += (init?.body as Blob).size;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset) },
        });
      },
    );
    const firstClient = clientWithStatus("processing").client;
    await uploadPhotoMoment(
      file,
      draft,
      firstAttempt,
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => firstClient,
        fetch: fetcher,
        hash: vi.fn(async () => "d".repeat(64)),
        resumeStore,
        statusAttempts: 1,
      },
    );

    const resumedAttempt = createPhotoUploadAttempt();
    const secondClient = clientWithStatus("processing").client;
    await uploadPhotoMoment(
      file,
      draft,
      resumedAttempt,
      new AbortController().signal,
      () => undefined,
      {
        createClient: () => secondClient,
        fetch: fetcher,
        hash: vi.fn(async () => "d".repeat(64)),
        resumeStore,
        statusAttempts: 1,
      },
    );

    expect(resumedAttempt).toMatchObject({
      ...firstKeys,
      intakeId,
      momentId,
      uploadUrl,
    });
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });
});

describe("hosted Vercel photo upload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not fall through to the local file journal on Vercel", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);

    await expect(
      uploadPhotoMoment(
        jpegFile(),
        draft,
        createPhotoUploadAttempt(),
        new AbortController().signal,
        () => undefined,
        { fetch: fetchFn, hash: vi.fn(async () => "a".repeat(64)) },
      ),
    ).rejects.toThrow("connected Our Days storage");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
