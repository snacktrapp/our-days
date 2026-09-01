// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  process: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

vi.mock("@/lib/photo-worker.server", () => ({
  PhotoWorkerError: class PhotoWorkerError extends Error {
    readonly retryable: boolean;

    constructor(message: string, retryable = true) {
      super(message);
      this.name = "PhotoWorkerError";
      this.retryable = retryable;
    }
  },
  processPhotoIntake: mocks.process,
}));

import { PhotoWorkerError } from "@/lib/photo-worker.server";
import { POST } from "./route";

const intakeId = "10000000-0000-4000-8000-000000000001";
const momentId = "20000000-0000-4000-8000-000000000002";

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
    mocks.getUser.mockReset();
    mocks.process.mockReset();
    mocks.rpc.mockReset();
    vi.stubEnv("OUR_DAYS_PHOTO_POSTING_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "30000000-0000-4000-8000-000000000003" } },
      error: null,
    });
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "processing" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ moment_id: momentId, status: "published" }],
        error: null,
      });
    mocks.process.mockResolvedValue(undefined);
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

  it("verifies family access, processes, and confirms publication", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, momentId });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_photo_moment_status", {
      intake_id: intakeId,
    });
    expect(mocks.process).toHaveBeenCalledWith(intakeId);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not rerun work for an already published photo", async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: [{ moment_id: momentId, status: "published" }],
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("uses the same neutral response when the session lacks exact access", async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("returns a retryable response for a temporary worker failure", async () => {
    mocks.process.mockRejectedValue(
      new PhotoWorkerError("private details", true),
    );
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      message: "The photo is still being prepared. Check again shortly.",
    });
  });

  it("returns a stable attention response after a terminal safe failure", async () => {
    mocks.process.mockRejectedValue(
      new PhotoWorkerError("private details", false),
    );
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      message: "This file could not be verified as a safe photo.",
    });
  });
});
