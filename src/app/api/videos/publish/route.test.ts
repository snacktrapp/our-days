// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deliver: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

vi.mock("@/lib/notifications/family-activity", () => ({
  notifyFamilyActivity: mocks.deliver,
}));

import { POST } from "./route";

const requestId = "10000000-0000-4000-8000-000000000001";
const momentId = "20000000-0000-4000-8000-000000000002";

function request(
  body: unknown = { requestId, momentId },
  headers: HeadersInit = {
    host: "journal.example.test",
    origin: "https://journal.example.test",
  },
) {
  return POST(
    new Request("https://journal.example.test/api/videos/publish", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    }),
  );
}

describe("private video publish route", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.deliver.mockReset();
    mocks.deliver.mockResolvedValue({ status: "delivered", count: 1 });
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "30000000-0000-4000-8000-000000000003" } },
      error: null,
    });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_video_moment_delivery") {
        return { data: [], error: null };
      }
      if (name === "finalize_video_moment") {
        return { data: momentId, error: null };
      }
      return { data: null, error: null };
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cross-origin and invalid requests", async () => {
    expect(
      (
        await request(
          { requestId, momentId },
          {
            host: "journal.example.test",
            origin: "https://other.example.test",
          },
        )
      ).status,
    ).toBe(404);
    expect((await request({ requestId: "not-a-uuid" })).status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("finalizes on the server and delivers one family activity push", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, momentId });
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_video_moment", {
      request_id: requestId,
    });
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ rpc: mocks.rpc }),
      "moment",
      momentId,
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("does not re-send when the video is already published", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_video_moment_delivery") {
        return { data: [{ object_path: "videos/one" }], error: null };
      }
      return { data: momentId, error: null };
    });

    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "finalize_video_moment",
      expect.anything(),
    );
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
