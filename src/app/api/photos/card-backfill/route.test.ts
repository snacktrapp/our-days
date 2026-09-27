// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  claimPhotoCardBackfillLease,
  displayBytesMatchLease,
  executePhotoCardBackfill,
  PhotoCardBackfillListError,
  photoCardBackfillHeadroomMs,
  photoCardBackfillMaxDurationSeconds,
  photoCardBackfillShouldStop,
  type PhotoCardBackfillIo,
  type PhotoCardLease,
} from "@/lib/photo-card-backfill.server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  withWorker: vi.fn(),
}));

const state = vi.hoisted(() => ({
  io: null as PhotoCardBackfillIo | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    void callback;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/photo-worker.server", () => ({
  withAuthenticatedPhotoWorker: mocks.withWorker,
}));

import { GET, POST } from "./route";

const userId = "10000000-0000-4000-8000-0000000000c1";
const originalId = "10000000-0000-4000-8000-0000000000b1";
const attemptId = "10000000-0000-4000-8000-0000000000d1";
const firstId = "10000000-0000-4000-8000-0000000000a1";
const secondId = "10000000-0000-4000-8000-0000000000a2";
const workerEmail = "photo-worker@example.test";
const workerPassword = "plain-worker-password";
const workerToken = "sb-worker-access-token-should-stay-out";
const storageUrl =
  "https://storage-sentinel.supabase.co/storage/v1/object/our-days-display/display/secret.webp";

let display = new Uint8Array();

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function leaseFor(
  id: string,
  bytes: Uint8Array,
  overrides: Partial<PhotoCardLease> = {},
): PhotoCardLease {
  return {
    bucketId: "our-days-display",
    displayDerivativeId: id,
    objectPath: `display/${id}/${attemptId}.webp`,
    originalId,
    outputSha256Hex: sha256(bytes),
    outputSizeBytes: bytes.byteLength,
    ...overrides,
  };
}

function rowFor(id: string) {
  return {
    bucket_id: "our-days-display",
    display_derivative_id: id,
    object_path: `display/${id}/${attemptId}.webp`,
    original_id: originalId,
    output_height: 8,
    output_mime_type: "image/webp",
    output_sha256_hex: "ab".repeat(32),
    output_size_bytes: 12,
    output_width: 8,
    state: "leased",
  };
}

function operationsClient(
  user:
    | { data: { user: { id: string } | null }; error: null }
    | { data: { user: null }; error: { message: string } },
  membership:
    | {
        data: { directory_kind: string; status: string }[] | null;
        error: null;
      }
    | { data: null; error: { message: string } },
) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(async () => membership),
    select: vi.fn(() => query),
  };
  return {
    auth: { getUser: vi.fn(async () => user) },
    from: vi.fn(() => query),
    query,
  };
}

function signedInOperations() {
  const client = operationsClient(
    { data: { user: { id: userId } }, error: null },
    {
      data: [{ directory_kind: "operations", status: "active" }],
      error: null,
    },
  );
  mocks.createClient.mockResolvedValue(client);
  return client;
}

function post(body?: unknown, { json = true }: { json?: boolean } = {}) {
  return POST(
    new Request("https://journal.example.test/api/photos/card-backfill", {
      body: json ? JSON.stringify(body ?? {}) : String(body ?? ""),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

function assertNoSecrets(serialized: string) {
  expect(serialized).not.toContain(workerEmail);
  expect(serialized).not.toContain(workerPassword);
  expect(serialized).not.toContain(workerToken);
  expect(serialized).not.toContain("storage-sentinel");
  expect(serialized).not.toContain("supabase.co");
  expect(serialized).not.toContain("/storage/");
  expect(serialized).not.toContain("service_role");
  expect(serialized).not.toContain(storageUrl);
}

describe("photo card backfill route", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    display = new Uint8Array(
      await sharp({
        create: {
          background: { b: 3, g: 2, r: 1 },
          channels: 3,
          height: 8,
          width: 8,
        },
      })
        .webp()
        .toBuffer(),
    );
  });

  beforeEach(() => {
    state.io = null;
    mocks.createClient.mockReset();
    mocks.withWorker.mockReset();
    mocks.withWorker.mockImplementation(async (work) => {
      if (!state.io) throw new Error("missing backfill io");
      return work(state.io);
    });
    vi.stubEnv("OUR_DAYS_PHOTO_WORKER_EMAIL", workerEmail);
    vi.stubEnv("OUR_DAYS_PHOTO_WORKER_PASSWORD", workerPassword);
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("404s anonymous callers before the photo worker signs in", async () => {
    mocks.createClient.mockResolvedValue(
      operationsClient(
        { data: { user: null }, error: null },
        { data: [], error: null },
      ),
    );
    const response = await post({ live: true });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.withWorker).not.toHaveBeenCalled();
  });

  it("404s a verified caller who is not Operations", async () => {
    mocks.createClient.mockResolvedValue(
      operationsClient(
        { data: { user: { id: userId } }, error: null },
        {
          data: [{ directory_kind: "journal", status: "active" }],
          error: null,
        },
      ),
    );
    const response = await post({ live: true });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(mocks.withWorker).not.toHaveBeenCalled();
  });

  it("404s when the operations membership is not active", async () => {
    mocks.createClient.mockResolvedValue(
      operationsClient(
        { data: { user: { id: userId } }, error: null },
        {
          data: [{ directory_kind: "operations", status: "revoked" }],
          error: null,
        },
      ),
    );
    const response = await post({});
    expect(response.status).toBe(404);
    expect(mocks.withWorker).not.toHaveBeenCalled();
  });

  it("404s when the membership lookup fails", async () => {
    mocks.createClient.mockResolvedValue(
      operationsClient(
        { data: { user: { id: userId } }, error: null },
        { data: null, error: { message: storageUrl } },
      ),
    );
    const response = await post({ live: true });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(mocks.withWorker).not.toHaveBeenCalled();
    assertNoSecrets(JSON.stringify(errorLog.mock.calls));
    assertNoSecrets(JSON.stringify(info.mock.calls));
  });

  it("rejects malformed JSON with an empty 400 and does not sign the worker in", async () => {
    signedInOperations();
    const response = await post("{", { json: false });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
    expect(mocks.withWorker).not.toHaveBeenCalled();

    for (const body of [
      { limit: 0 },
      { limit: 11 },
      { budgetMs: 999 },
      { budgetMs: 240_001 },
      { after: "not-a-uuid" },
      { live: "yes" },
      { unexpected: true },
    ]) {
      const rejected = await post(body);
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toBe("");
    }
    expect(mocks.withWorker).not.toHaveBeenCalled();
  });

  it("rejects other methods", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("");
    expect(response.headers.get("allow")).toBe("POST");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.withWorker).not.toHaveBeenCalled();
  });

  it("dry-run lists one page and does not claim, upload, or record", async () => {
    signedInOperations();
    const claim = vi.fn();
    const upload = vi.fn();
    const record = vi.fn();
    const release = vi.fn();
    const readDisplay = vi.fn();
    state.io = {
      claim,
      identity: vi.fn(),
      listCandidates: vi.fn(async () => [{ id: firstId }, { id: secondId }]),
      readBack: vi.fn(),
      readDisplay,
      record,
      release,
      upload,
    };
    const response = await post({});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      candidates: 2,
      failed: 0,
      items: [],
      made: 0,
      mode: "dry-run",
      next: null,
      skipped: 0,
    });
    expect(body.elapsedMs).toEqual(expect.any(Number));
    expect(claim).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(readDisplay).not.toHaveBeenCalled();
    assertNoSecrets(JSON.stringify(body));
  });

  it("returns the page cursor when the dry-run page is full", async () => {
    signedInOperations();
    state.io = {
      claim: vi.fn(),
      identity: vi.fn(),
      listCandidates: vi.fn(async () => [{ id: firstId }, { id: secondId }]),
      readBack: vi.fn(),
      readDisplay: vi.fn(),
      record: vi.fn(),
      release: vi.fn(),
      upload: vi.fn(),
    };
    const response = await post({ limit: 2 });
    const body = await response.json();
    expect(body.mode).toBe("dry-run");
    expect(body.next).toBe(secondId);
    expect(state.io.claim).not.toHaveBeenCalled();
  });

  it("records made=N on the live happy path, one derivative at a time", async () => {
    signedInOperations();
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const objects = new Map<string, Uint8Array>();
    const recorded: string[] = [];
    state.io = {
      claim: vi.fn(async (id: string) => {
        order.push(`claim:${id}`);
        return leaseFor(id, display);
      }),
      identity: vi.fn(async () => {
        order.push("identity");
        return { id: "obj-1", version: "v1" };
      }),
      listCandidates: vi.fn(async () => [{ id: firstId }, { id: secondId }]),
      readBack: vi.fn(async (_lease: PhotoCardLease, path: string) => {
        order.push("readback");
        const bytes = objects.get(path);
        if (!bytes) throw new Error("missing");
        return bytes;
      }),
      readDisplay: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push("read");
        await Promise.resolve();
        active -= 1;
        return display;
      }),
      record: vi.fn(async (lease: PhotoCardLease) => {
        order.push("record");
        recorded.push(lease.displayDerivativeId);
      }),
      release: vi.fn(async (id: string) => {
        order.push(`release:${id}`);
      }),
      upload: vi.fn(async (_lease, path: string, bytes: Uint8Array) => {
        order.push("upload");
        objects.set(path, bytes);
      }),
    };
    const response = await post({ live: true });
    const body = await response.json();
    expect(body.mode).toBe("live");
    expect(body.made).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.candidates).toBe(2);
    expect(body.next).toBeNull();
    expect(recorded).toEqual([firstId, secondId]);
    expect(peak).toBe(1);
    expect(order).toEqual([
      `claim:${firstId}`,
      "read",
      "upload",
      "identity",
      "readback",
      "record",
      `release:${firstId}`,
      `claim:${secondId}`,
      "read",
      "upload",
      "identity",
      "readback",
      "record",
      `release:${secondId}`,
    ]);
    expect(body.items).toEqual([
      expect.objectContaining({ id: firstId, outcome: "made" }),
      expect.objectContaining({ id: secondId, outcome: "made" }),
    ]);
    expect(body.items[0]).not.toHaveProperty("stage");
    assertNoSecrets(JSON.stringify(body));
    assertNoSecrets(JSON.stringify(info.mock.calls));
  });

  it("counts a sha or size mismatch as failed and does not upload", async () => {
    signedInOperations();
    const upload = vi.fn();
    const release = vi.fn();
    state.io = {
      claim: vi.fn(async (id: string) =>
        leaseFor(id, display, {
          objectPath: storageUrl,
          outputSha256Hex: "ab".repeat(32),
        }),
      ),
      identity: vi.fn(),
      listCandidates: vi.fn(async () => [{ id: firstId }]),
      readBack: vi.fn(),
      readDisplay: vi.fn(async () => display),
      record: vi.fn(),
      release,
      upload,
    };
    const mismatched = await post({ live: true });
    const mismatchBody = await mismatched.json();
    expect(mismatchBody.failed).toBe(1);
    expect(mismatchBody.made).toBe(0);
    expect(mismatchBody.items).toEqual([
      expect.objectContaining({ id: firstId, outcome: "failed", stage: "sha" }),
    ]);
    expect(upload).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(firstId);
    assertNoSecrets(JSON.stringify(mismatchBody));
    assertNoSecrets(JSON.stringify(errorLog.mock.calls));

    upload.mockClear();
    release.mockClear();
    state.io = {
      ...state.io,
      claim: vi.fn(async (id: string) =>
        leaseFor(id, display, {
          outputSizeBytes: display.byteLength + 1,
        }),
      ),
    };
    const wrongSize = await (await post({ live: true })).json();
    expect(wrongSize.items[0]).toMatchObject({
      outcome: "failed",
      stage: "sha",
    });
    expect(upload).not.toHaveBeenCalled();
    expect(state.io.release).toHaveBeenCalledWith(firstId);
  });

  it("skips a derivative whose lease is refused and does not release it", async () => {
    signedInOperations();
    const release = vi.fn();
    const readDisplay = vi.fn();
    state.io = {
      claim: vi.fn(async () => null),
      identity: vi.fn(),
      listCandidates: vi.fn(async () => [{ id: firstId }]),
      readBack: vi.fn(),
      readDisplay,
      record: vi.fn(),
      release,
      upload: vi.fn(),
    };
    const body = await (await post({ live: true })).json();
    expect(body.skipped).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.items[0]).toMatchObject({ id: firstId, outcome: "skipped" });
    expect(body.items[0]).not.toHaveProperty("stage");
    expect(release).not.toHaveBeenCalled();
    expect(readDisplay).not.toHaveBeenCalled();
  });

  it("fails an upload with no existing object and still releases the lease", async () => {
    signedInOperations();
    const record = vi.fn();
    const release = vi.fn();
    state.io = {
      claim: vi.fn(async (id: string) => leaseFor(id, display)),
      identity: vi.fn(async () => {
        throw new Error(`missing ${storageUrl} ${workerToken}`);
      }),
      listCandidates: vi.fn(async () => [{ id: firstId }]),
      readBack: vi.fn(),
      readDisplay: vi.fn(async () => display),
      record,
      release,
      upload: vi.fn(async () => {
        throw new Error(`stored at ${storageUrl} with ${workerPassword}`);
      }),
    };
    const body = await (await post({ live: true })).json();
    expect(body.failed).toBe(1);
    expect(body.made).toBe(0);
    expect(body.items[0]).toMatchObject({
      id: firstId,
      outcome: "failed",
      stage: "upload",
    });
    expect(record).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(firstId);
    assertNoSecrets(JSON.stringify(body));
    assertNoSecrets(JSON.stringify(errorLog.mock.calls));
    assertNoSecrets(JSON.stringify(info.mock.calls));
  });

  it("stops starting items once the time budget is spent and returns next", async () => {
    signedInOperations();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const claim = vi.fn(async () => {
      clock = 1_000;
      return null;
    });
    state.io = {
      claim,
      identity: vi.fn(),
      listCandidates: vi.fn(async () => [{ id: firstId }, { id: secondId }]),
      readBack: vi.fn(),
      readDisplay: vi.fn(),
      record: vi.fn(),
      release: vi.fn(),
      upload: vi.fn(),
    };
    const body = await (
      await post({ budgetMs: 1_000, limit: 2, live: true })
    ).json();
    expect(body.candidates).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: firstId, outcome: "skipped" });
    expect(body.next).toBe(secondId);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(body.made + body.skipped + body.failed).toBe(1);
  });

  it("leaves headroom under the function duration before starting another item", () => {
    const ceiling =
      photoCardBackfillMaxDurationSeconds * 1000 - photoCardBackfillHeadroomMs;
    expect(photoCardBackfillShouldStop(ceiling - 1, 1_000_000)).toBe(false);
    expect(photoCardBackfillShouldStop(ceiling, 1_000_000)).toBe(true);
    expect(photoCardBackfillShouldStop(59_999, 60_000)).toBe(false);
    expect(photoCardBackfillShouldStop(60_000, 60_000)).toBe(true);
  });

  it("is safe to call again after every candidate has a card", async () => {
    const recorded = new Set<string>();
    const bytes = Uint8Array.from([4, 5, 6]);
    const io: PhotoCardBackfillIo = {
      claim: vi.fn(async (id: string) => leaseFor(id, bytes)),
      identity: vi.fn(async () => ({ id: "obj-1", version: "v1" })),
      listCandidates: vi.fn(async () =>
        [firstId, secondId]
          .filter((id) => !recorded.has(id))
          .map((id) => ({ id })),
      ),
      readBack: vi.fn(async () => Uint8Array.from([9])),
      readDisplay: vi.fn(async () => bytes),
      record: vi.fn(async (lease: PhotoCardLease) => {
        recorded.add(lease.displayDerivativeId);
      }),
      release: vi.fn(async () => undefined),
      upload: vi.fn(async () => undefined),
    };
    const render = vi.fn(async () => ({
      bytes: Uint8Array.from([9]),
      height: 2,
      width: 2,
    }));
    const first = await executePhotoCardBackfill(
      io,
      { after: null, budgetMs: 60_000, limit: 10, live: true },
      () => 0,
      render,
    );
    expect(first.made).toBe(2);
    expect(first.candidates).toBe(2);
    const second = await executePhotoCardBackfill(
      io,
      { after: null, budgetMs: 60_000, limit: 10, live: true },
      () => 0,
      render,
    );
    expect(second.candidates).toBe(0);
    expect(second.made).toBe(0);
    expect(second.next).toBeNull();
    expect(io.claim).toHaveBeenCalledTimes(2);
  });

  it("does not echo worker credentials or storage URLs", async () => {
    signedInOperations();
    state.io = {
      claim: vi.fn(async (id: string) =>
        leaseFor(id, display, { objectPath: storageUrl }),
      ),
      identity: vi.fn(),
      listCandidates: vi.fn(async () => [{ id: firstId }, { id: storageUrl }]),
      readBack: vi.fn(),
      readDisplay: vi.fn(async () => {
        throw new Error(
          `${workerEmail} ${workerPassword} ${workerToken} ${storageUrl}`,
        );
      }),
      record: vi.fn(),
      release: vi.fn(),
      upload: vi.fn(),
    };
    const response = await post({ live: true });
    const serialized = JSON.stringify(await response.json());
    assertNoSecrets(serialized);
    assertNoSecrets(JSON.stringify(info.mock.calls));
    assertNoSecrets(JSON.stringify(errorLog.mock.calls));
    expect(serialized).toContain(firstId);
    expect(serialized).not.toContain(storageUrl);
  });

  it("returns an empty 503 when listing fails after the worker signs in", async () => {
    signedInOperations();
    state.io = {
      claim: vi.fn(),
      identity: vi.fn(),
      listCandidates: vi.fn(async () => {
        throw new PhotoCardBackfillListError();
      }),
      readBack: vi.fn(),
      readDisplay: vi.fn(),
      record: vi.fn(),
      release: vi.fn(),
      upload: vi.fn(),
    };
    const response = await post({ live: true });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(mocks.withWorker).toHaveBeenCalledOnce();
  });

  it("releases an unsafe lease instead of reading its object path", async () => {
    const release = vi.fn(async () => undefined);
    await expect(
      claimPhotoCardBackfillLease(
        async () => ({
          data: [{ ...rowFor(firstId), object_path: storageUrl }],
          error: null,
        }),
        release,
        firstId,
      ),
    ).rejects.toMatchObject({ stage: "read" });
    expect(release).toHaveBeenCalledOnce();

    const refused = vi.fn();
    await expect(
      claimPhotoCardBackfillLease(
        async () => ({
          data: null,
          error: { message: `${workerPassword} ${storageUrl}` },
        }),
        refused,
        firstId,
      ),
    ).resolves.toBeNull();
    expect(refused).not.toHaveBeenCalled();

    const granted = await claimPhotoCardBackfillLease(
      async () => ({ data: [rowFor(firstId)], error: null }),
      vi.fn(),
      firstId,
    );
    expect(granted?.objectPath).toBe(`display/${firstId}/${attemptId}.webp`);
    expect(granted?.bucketId).toBe("our-days-display");
    expect(
      displayBytesMatchLease(Uint8Array.from([1]), {
        outputSha256Hex: sha256(Uint8Array.from([1])),
        outputSizeBytes: 2,
      }),
    ).toBe(false);
  });

  it("keeps the worker helper from returning or logging credentials", () => {
    const workerSource = readFileSync(
      new URL("../../../../lib/photo-worker.server.ts", import.meta.url),
      "utf8",
    );
    const routeSource = readFileSync(
      new URL("./route.ts", import.meta.url),
      "utf8",
    );
    const backfillSource = readFileSync(
      new URL("../../../../lib/photo-card-backfill.server.ts", import.meta.url),
      "utf8",
    );
    const helper = workerSource.slice(
      workerSource.indexOf(
        "export async function withAuthenticatedPhotoWorker",
      ),
    );
    expect(helper).toContain('signOut({ scope: "local" })');
    expect(helper.indexOf("finally")).toBeGreaterThan(-1);
    expect(helper.indexOf("finally")).toBeLessThan(
      helper.indexOf('signOut({ scope: "local" })'),
    );
    expect(routeSource).toContain('export const runtime = "nodejs"');
    expect(routeSource).toContain('export const dynamic = "force-dynamic"');
    expect(routeSource).toContain("export const maxDuration = 300");
    expect(routeSource).not.toMatch(
      /service_role|SERVICE_ROLE|OUR_DAYS_PHOTO_WORKER/,
    );
    expect(backfillSource).not.toMatch(
      /service_role|SERVICE_ROLE|OUR_DAYS_PHOTO_WORKER/,
    );
    expect(workerSource).toContain("runLeasedCardRendition");
    expect(workerSource).toContain("lease.display_object_path");
    expect(workerSource).toContain("schedulePhotoCardRenditions(");
    expect(workerSource).not.toMatch(/await\s+schedulePhotoCardRenditions/);
  });
});
