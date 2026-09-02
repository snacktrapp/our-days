// @vitest-environment node

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = Readonly<{
  waitUntil: (work: Promise<unknown>) => void;
}>;

type WorkerListener = (event: WorkerEvent) => void;

async function readWorkerSource() {
  return readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
}

function createLifecycleHarness(source: string) {
  const listeners = new Map<string, WorkerListener>();
  const cacheNames = new Set([
    "our-days-public-shell-v3",
    "our-days-public-shell-v4",
    "another-app-cache",
  ]);
  const deleteCache = vi.fn(async (name: string) => cacheNames.delete(name));
  const claim = vi.fn().mockResolvedValue(undefined);
  const unregister = vi.fn().mockResolvedValue(true);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const caches = {
    keys: vi.fn(async () => [...cacheNames]),
    delete: deleteCache,
  };
  const self = {
    clients: { claim },
    registration: { unregister },
    skipWaiting,
    addEventListener: (name: string, listener: WorkerListener) => {
      listeners.set(name, listener);
    },
  };

  runInNewContext(source, { self, caches });

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

  return { claim, deleteCache, dispatch, skipWaiting, unregister };
}

describe("retired public service worker contract", () => {
  it("does not intercept requests after connected navigation is enabled", async () => {
    const source = await readWorkerSource();
    expect(source).not.toContain('addEventListener("fetch"');
    expect(source).not.toContain("respondWith");
    expect(source).toContain("self.skipWaiting()");
    expect(source).toContain("self.registration.unregister()");
  });

  it("activates immediately, purges only legacy app caches, and unregisters", async () => {
    const source = await readWorkerSource();
    const harness = createLifecycleHarness(source);

    await harness.dispatch("install");
    expect(harness.skipWaiting).toHaveBeenCalledOnce();

    await harness.dispatch("activate");
    expect(harness.deleteCache).toHaveBeenCalledWith(
      "our-days-public-shell-v3",
    );
    expect(harness.deleteCache).toHaveBeenCalledWith(
      "our-days-public-shell-v4",
    );
    expect(harness.deleteCache).not.toHaveBeenCalledWith("another-app-cache");
    expect(harness.unregister).toHaveBeenCalledOnce();
    expect(harness.claim).toHaveBeenCalledOnce();
  });
});
