// @vitest-environment node

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = Readonly<{
  request?: Request;
  respondWith?: (work: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
}>;

type WorkerListener = (event: WorkerEvent) => void;

async function readWorkerSource() {
  return readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
}

function createLifecycleHarness(
  source: string,
  options: Readonly<{ existingCaches?: string[]; failInstall?: boolean }> = {},
) {
  const listeners = new Map<string, WorkerListener>();
  const cacheNames = new Set(options.existingCaches ?? []);
  const addAll = options.failInstall
    ? vi.fn().mockRejectedValue(new Error("shell asset unavailable"))
    : vi.fn().mockResolvedValue(undefined);
  const deleteCache = vi.fn(async (name: string) => cacheNames.delete(name));
  const claim = vi.fn().mockResolvedValue(undefined);

  const caches = {
    open: vi.fn(async (name: string) => {
      cacheNames.add(name);
      return { addAll };
    }),
    keys: vi.fn(async () => [...cacheNames]),
    delete: deleteCache,
    match: vi.fn(),
  };
  const self = {
    location: { origin: "https://our-days.test" },
    clients: { claim },
    addEventListener: (name: string, listener: WorkerListener) => {
      listeners.set(name, listener);
    },
  };

  runInNewContext(source, { self, caches, URL, fetch: vi.fn() });

  const dispatch = (name: string) => {
    let work: Promise<unknown> | undefined;
    listeners.get(name)?.({
      waitUntil: (promise) => {
        work = promise;
      },
    });
    if (!work) throw new Error(`No waitUntil work registered for ${name}.`);
    return work;
  };

  return { addAll, cacheNames, claim, deleteCache, dispatch };
}

async function dispatchFetch(
  source: string,
  request: Request,
  options: Readonly<{
    cacheMatch: () => Promise<Response | undefined>;
    networkFetch: () => Promise<Response>;
  }>,
) {
  const listeners = new Map<string, WorkerListener>();
  const self = {
    location: { origin: "https://our-days.test" },
    addEventListener: (name: string, listener: WorkerListener) => {
      listeners.set(name, listener);
    },
  };
  runInNewContext(source, {
    self,
    caches: { match: options.cacheMatch },
    URL,
    Response,
    fetch: options.networkFetch,
  });

  let responseWork: Promise<Response> | undefined;
  listeners.get("fetch")?.({
    request,
    respondWith: (work) => {
      responseWork = work;
    },
    waitUntil: () => {},
  });
  return responseWork;
}

describe("public service worker contract", () => {
  it("caches only the explicit public shell and never runtime journal responses", async () => {
    const source = await readWorkerSource();
    expect(source).toContain("const CACHE_NAME = `${CACHE_PREFIX}v4`");
    expect(source).toContain('"/offline.html"');
    expect(source).toContain('"/offline.css"');
    expect(source).toContain('"/manifest.webmanifest"');
    expect(source).not.toContain('"/"');
    expect(source).not.toContain("cache.put");
    expect(source).not.toContain("skipWaiting");
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain('caches.match("/offline.html")');
  });

  it("leaves the active cache untouched when a required update asset fails", async () => {
    const source = await readWorkerSource();
    const harness = createLifecycleHarness(source, {
      existingCaches: ["our-days-public-shell-v3"],
      failInstall: true,
    });

    await expect(harness.dispatch("install")).rejects.toThrow(
      "shell asset unavailable",
    );
    expect(harness.cacheNames).toContain("our-days-public-shell-v3");
    expect(harness.deleteCache).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
  });

  it("installs a complete update before activating and purges only old app caches", async () => {
    const source = await readWorkerSource();
    const harness = createLifecycleHarness(source, {
      existingCaches: ["our-days-public-shell-v3", "another-app-cache"],
    });

    await harness.dispatch("install");
    expect(harness.addAll).toHaveBeenCalledWith([
      "/offline.html",
      "/offline.css",
      "/manifest.webmanifest",
      "/icon-192.png",
      "/icon-512.png",
      "/apple-touch-icon.png",
    ]);
    await harness.dispatch("activate");
    expect(harness.deleteCache).toHaveBeenCalledWith(
      "our-days-public-shell-v3",
    );
    expect(harness.deleteCache).not.toHaveBeenCalledWith("another-app-cache");
    expect(harness.cacheNames).toContain("our-days-public-shell-v4");
    expect(harness.claim).toHaveBeenCalledOnce();
  });

  it("recovers from a rejected public-shell cache lookup without rejecting respondWith", async () => {
    const source = await readWorkerSource();
    const response = await dispatchFetch(
      source,
      new Request("https://our-days.test/offline.css"),
      {
        cacheMatch: vi.fn().mockRejectedValue(new Error("cache unavailable")),
        networkFetch: vi
          .fn()
          .mockRejectedValue(new Error("network unavailable")),
      },
    );

    expect(response?.status).toBe(503);
    expect(response?.statusText).toBe(
      "Public shell asset temporarily unavailable",
    );
  });

  it("does not intercept browser-owned manifest and icon requests", async () => {
    const source = await readWorkerSource();
    const cacheMatch = vi.fn();
    const networkFetch = vi.fn();
    const response = await dispatchFetch(
      source,
      new Request("https://our-days.test/apple-touch-icon.png"),
      { cacheMatch, networkFetch },
    );

    expect(response).toBeUndefined();
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("recovers from rejected navigation network and cache fallbacks", async () => {
    const source = await readWorkerSource();
    const response = await dispatchFetch(
      source,
      {
        method: "GET",
        mode: "navigate",
        url: "https://our-days.test/family",
      } as Request,
      {
        cacheMatch: vi.fn().mockRejectedValue(new Error("cache unavailable")),
        networkFetch: vi
          .fn()
          .mockRejectedValue(new Error("network unavailable")),
      },
    );

    expect(response?.status).toBe(503);
    expect(response?.statusText).toBe("Offline shell temporarily unavailable");
  });
});
