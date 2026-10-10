// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deliver: vi.fn(),
  getUser: vi.fn(),
  process: vi.fn(),
  rpc: vi.fn(),
  withWorkerClient: vi.fn(),
  workerRemove: vi.fn(),
  workerStorageFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

vi.mock("@/lib/web-push/deliver-activity", () => ({
  deliverActivityWebPush: mocks.deliver,
}));

vi.mock("@/lib/photo-worker.server", () => ({
  PHOTO_WORKER_VERSION: "test-photo-worker-version",
  PhotoWorkerError: class PhotoWorkerError extends Error {
    readonly retryable: boolean;
    readonly stage: string;
    readonly code: string;

    constructor(
      message: string,
      retryable = true,
      stage = "worker",
      code = "PHOTO_WORKER_FAILED",
    ) {
      super(message);
      this.name = "PhotoWorkerError";
      this.retryable = retryable;
      this.stage = stage;
      this.code = code;
    }
  },
  processPhotoIntake: mocks.process,
  withAuthenticatedPhotoWorkerClient: mocks.withWorkerClient,
}));

import { PhotoWorkerError } from "@/lib/photo-worker.server";
import { POST } from "./route";

const intakeId = "10000000-0000-4000-8000-000000000001";
const momentId = "20000000-0000-4000-8000-000000000002";
const intakeObjectPath = `intake/${intakeId}`;

function request(
  body: unknown = { intakeId },
  headers: HeadersInit = {
    host: "journal.example.test",
    origin: "https://journal.example.test",
  },
) {
  return POST(
    new Request("https://journal.example.test/api/photos/process", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    }),
  );
}

describe("private photo processing route", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.deliver.mockReset();
    mocks.deliver.mockResolvedValue(undefined);
    mocks.getUser.mockReset();
    mocks.process.mockReset();
    mocks.rpc.mockReset();
    mocks.withWorkerClient.mockReset();
    mocks.workerRemove.mockReset();
    mocks.workerStorageFrom.mockReset();
    vi.stubEnv("OUR_DAYS_PHOTO_POSTING_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "30000000-0000-4000-8000-000000000003" } },
      error: null,
    });
    const statusQueue: Array<{ moment_id: string | null; status: string }> = [
      { moment_id: momentId, status: "processing" },
      { moment_id: momentId, status: "published" },
    ];
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_photo_moment_status") {
        const next = statusQueue.shift() ?? statusQueue[statusQueue.length - 1];
        return { data: next ? [next] : [], error: null };
      }
      if (name === "cleanup_published_photo_intake") {
        return {
          data: [
            {
              bucket_id: "our-days-intake",
              intake_id: intakeId,
              object_path: intakeObjectPath,
              reason: "safe_to_delete",
              safe_to_delete: true,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: `Unexpected RPC: ${name}` } };
    });
    mocks.process.mockResolvedValue(undefined);
    mocks.workerRemove.mockResolvedValue({
      data: [{ name: intakeObjectPath }],
      error: null,
    });
    mocks.workerStorageFrom.mockImplementation((bucket: string) => ({
      remove:
        bucket === "our-days-intake"
          ? mocks.workerRemove
          : vi.fn(async () => ({ data: [], error: null })),
    }));
    mocks.withWorkerClient.mockImplementation(
      async (work: (client: unknown) => unknown) =>
        work({
          storage: { from: mocks.workerStorageFrom },
        }),
    );
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("fails closed before Supabase when posting is disabled", async () => {
    vi.stubEnv("OUR_DAYS_PHOTO_POSTING_MODE", "disabled");
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and invalid requests", async () => {
    expect(
      (
        await request(
          { intakeId },
          {
            host: "journal.example.test",
            origin: "https://other.example.test",
          },
        )
      ).status,
    ).toBe(404);
    expect((await request({ intakeId: "not-a-uuid" })).status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("accepts hosted Preview origin even when Vercel forwards a ported host", async () => {
    const previewHost =
      "our-days-git-cursor-local-journal-n-6b5630-snacktrapps-projects.vercel.app";
    const response = await request(
      { intakeId },
      {
        host: `${previewHost}:443`,
        origin: `https://${previewHost}`,
        "x-forwarded-host": `${previewHost}:443, ${previewHost}`,
      },
    );
    expect(response.status).toBe(200);
    expect(mocks.process).toHaveBeenCalledWith(intakeId);
  });

  it("accepts hosted Preview origin when it matches the derived site origin", async () => {
    const previewHost =
      "our-days-git-cursor-local-journal-n-6b5630-snacktrapps-projects.vercel.app";
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", previewHost);
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    const response = await request(
      { intakeId },
      {
        host: "localhost:3000",
        origin: `https://${previewHost}`,
      },
    );
    expect(response.status).toBe(200);
    expect(mocks.process).toHaveBeenCalledWith(intakeId);
  });

  it("verifies family access, processes, and confirms publication", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, momentId });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_photo_moment_status", {
      intake_id: intakeId,
    });
    expect(mocks.process).toHaveBeenCalledWith(intakeId);
    expect(mocks.rpc).toHaveBeenCalledWith("cleanup_published_photo_intake", {
      intake_id: intakeId,
    });
    expect(mocks.withWorkerClient).toHaveBeenCalledTimes(1);
    expect(mocks.workerStorageFrom).toHaveBeenCalledWith("our-days-intake");
    expect(mocks.workerRemove).toHaveBeenCalledWith([intakeObjectPath]);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not rerun work for an already published photo", async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_photo_moment_status") {
        return {
          data: [{ moment_id: momentId, status: "published" }],
          error: null,
        };
      }
      if (name === "cleanup_published_photo_intake") {
        return {
          data: [
            {
              bucket_id: "our-days-intake",
              intake_id: intakeId,
              object_path: intakeObjectPath,
              reason: "safe_to_delete",
              safe_to_delete: true,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: `Unexpected RPC: ${name}` } };
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("cleanup_published_photo_intake", {
      intake_id: intakeId,
    });
    expect(mocks.withWorkerClient).toHaveBeenCalledTimes(1);
    expect(mocks.workerStorageFrom).toHaveBeenCalledWith("our-days-intake");
    expect(mocks.workerRemove).toHaveBeenCalledWith([intakeObjectPath]);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("removes intake bytes only when cleanup verifies the intake is safe", async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_photo_moment_status") {
        return {
          data: [{ moment_id: momentId, status: "published" }],
          error: null,
        };
      }
      if (name === "cleanup_published_photo_intake") {
        return {
          data: [
            {
              bucket_id: null,
              intake_id: intakeId,
              object_path: null,
              reason: "not_published",
              safe_to_delete: false,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: `Unexpected RPC: ${name}` } };
    });

    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });

  it("uses the worker-authenticated storage client for intake removal", async () => {
    await request();
    expect(mocks.withWorkerClient).toHaveBeenCalledTimes(1);
    expect(mocks.workerStorageFrom).toHaveBeenCalledWith("our-days-intake");
  });

  it("keeps publishing non-fatal when storage API removal fails", async () => {
    mocks.workerRemove.mockResolvedValue({
      data: null,
      error: { message: "forbidden" },
    });

    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.withWorkerClient).toHaveBeenCalledTimes(1);
    expect(mocks.workerRemove).toHaveBeenCalledWith([intakeObjectPath]);
  });

  it("reports cleanup-not-removed when storage removal deletes nothing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    mocks.workerRemove.mockResolvedValue({
      data: [],
      error: null,
    });

    try {
      const response = await request();
      expect(response.status).toBe(200);
      expect(mocks.workerRemove).toHaveBeenCalledWith([intakeObjectPath]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[photo-process] cleanup-not-removed",
        expect.objectContaining({
          bucketId: "our-days-intake",
          intakeId,
          momentId,
          objectPath: intakeObjectPath,
        }),
      );
      expect(
        infoSpy.mock.calls.some(
          ([message]) => message === "[photo-process] intake cleanup removed",
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it("uses the same neutral response when the session lacks exact access", async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });

  it("returns a retryable response for a temporary worker failure", async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: [{ moment_id: momentId, status: "processing" }],
      error: null,
    });
    mocks.process.mockRejectedValue(
      new PhotoWorkerError("private details", true),
    );
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      message: "The photo is still being prepared. Check again shortly.",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "cleanup_published_photo_intake",
      {
        intake_id: intakeId,
      },
    );
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });

  it("returns success when another request published despite this worker error", async () => {
    mocks.process.mockRejectedValue(
      new PhotoWorkerError("Lease already claimed", true),
    );
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, momentId });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenCalledWith("cleanup_published_photo_intake", {
      intake_id: intakeId,
    });
    expect(mocks.withWorkerClient).toHaveBeenCalledTimes(1);
    expect(mocks.workerStorageFrom).toHaveBeenCalledWith("our-days-intake");
    expect(mocks.workerRemove).toHaveBeenCalledWith([intakeObjectPath]);
  });

  it("does not claim a failure is terminal when its status cannot be read", async () => {
    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      })
      .mockRejectedValueOnce(new Error("Network unavailable"));
    mocks.process.mockRejectedValue(
      new PhotoWorkerError("Private failure", false),
    );
    expect((await request()).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "cleanup_published_photo_intake",
      {
        intake_id: intakeId,
      },
    );
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });

  it("returns a stable attention response after a terminal safe failure", async () => {
    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ moment_id: null, status: "needs_attention" }],
        error: null,
      });
    mocks.process.mockRejectedValue(
      new PhotoWorkerError(
        "private details",
        false,
        "validation",
        "PHOTO_FORMAT_UNSUPPORTED",
      ),
    );
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      message: "This file could not be verified as a safe photo.",
    });
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });

  it("keeps a nonterminal worker invariant retryable", async () => {
    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      });
    mocks.process.mockRejectedValue(
      new PhotoWorkerError(
        "private details",
        false,
        "validation",
        "PHOTO_VALIDATION_CONTRACT_UNSAFE",
      ),
    );

    const response = await request();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      message: "The photo is still being prepared. Check again shortly.",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "cleanup_published_photo_intake",
      {
        intake_id: intakeId,
      },
    );
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });

  it("keeps intake bytes when processing is still incomplete", async () => {
    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      });
    const response = await request();
    expect(response.status).toBe(202);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "cleanup_published_photo_intake",
      {
        intake_id: intakeId,
      },
    );
    expect(mocks.withWorkerClient).not.toHaveBeenCalled();
    expect(mocks.workerRemove).not.toHaveBeenCalled();
  });
});
