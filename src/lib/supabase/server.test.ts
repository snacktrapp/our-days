import { afterEach, expect, it, vi } from "vitest";
import { createOurDaysServerClient } from "./server";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: vi.fn() }),
}));
vi.mock("./public-config", () => ({
  readSupabasePublicConfig: () => ({
    url: "https://example.supabase.co",
    publishableKey: "test-key",
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("logs preview request timing without private query parameters or object paths", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
  await createOurDaysServerClient();
  const request = mocks.create.mock.calls.at(-1)![2].global.fetch;
  await request("https://example.supabase.co/rest/v1/moments?id=eq.private-id");
  await request(
    "https://example.supabase.co/storage/v1/object/sign/private/family-photo.jpg?token=secret",
  );
  expect(log).toHaveBeenCalledWith(
    "[preview-supabase-timing]",
    expect.objectContaining({ operation: "rest/v1/moments", status: 200 }),
  );
  expect(log).toHaveBeenCalledWith(
    "[preview-supabase-timing]",
    expect.objectContaining({ operation: "storage", status: 200 }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /private-id|family-photo|secret/,
  );
});

it("aborts stalled journal reads when their deadline expires", async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          );
        }),
    ),
  );
  await createOurDaysServerClient({ readTimeoutMs: 8000 });
  const request = mocks.create.mock.calls.at(-1)![2].global.fetch;
  const pending = request("https://example.supabase.co/rest/v1/moments");
  const assertion = expect(pending).rejects.toMatchObject({
    name: "TimeoutError",
  });
  deadline.abort(new DOMException("Read timed out", "TimeoutError"));
  await assertion;
  expect(AbortSignal.timeout).toHaveBeenCalledWith(8000);
});

it("preserves caller cancellation alongside the deadline", async () => {
  const deadline = new AbortController();
  const caller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const fetchMock = vi.fn().mockResolvedValue(new Response());
  vi.stubGlobal("fetch", fetchMock);
  await createOurDaysServerClient({ readTimeoutMs: 8000 });
  const request = mocks.create.mock.calls.at(-1)![2].global.fetch;
  await request("https://example.supabase.co/rest/v1/moments", {
    signal: caller.signal,
  });
  caller.abort();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

it("leaves uploads and writes on the default client unchanged", async () => {
  await createOurDaysServerClient();
  expect(mocks.create.mock.calls.at(-1)![2].global).toBeUndefined();
});
