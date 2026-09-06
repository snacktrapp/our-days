// @vitest-environment node

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = Readonly<{
  waitUntil: (work: Promise<unknown>) => void;
  data?: { json: () => unknown };
  notification?: {
    close: () => void;
    data?: { url?: string };
  };
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
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const caches = {
    keys: vi.fn(async () => [...cacheNames]),
    delete: deleteCache,
  };
  const self = {
    location: { origin: "https://journal.example.com" },
    clients: { claim, matchAll, openWindow },
    registration: { showNotification },
    skipWaiting,
    addEventListener: (name: string, listener: WorkerListener) => {
      listeners.set(name, listener);
    },
  };

  runInNewContext(source, { self, caches, URL });

  const dispatch = (name: string, event: Partial<WorkerEvent> = {}) => {
    let work: Promise<unknown> | undefined;
    listeners.get(name)?.({
      waitUntil: (promise) => {
        work = promise;
      },
      ...event,
    });
    if (!work) throw new Error(`No waitUntil work registered for ${name}.`);
    return work;
  };

  return {
    claim,
    deleteCache,
    dispatch,
    focus,
    matchAll,
    navigate,
    openWindow,
    showNotification,
    skipWaiting,
  };
}

describe("push-capable public service worker contract", () => {
  it("does not intercept document navigations", async () => {
    const source = await readWorkerSource();
    expect(source).not.toContain('addEventListener("fetch"');
    expect(source).not.toContain("respondWith");
    expect(source).not.toContain("self.registration.unregister()");
    expect(source).toContain('addEventListener("push"');
    expect(source).toContain('addEventListener("notificationclick"');
  });

  it("activates immediately and purges only legacy app caches", async () => {
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
    expect(harness.claim).toHaveBeenCalledOnce();
  });

  it("shows a quiet banner and opens the moment on tap", async () => {
    const source = await readWorkerSource();
    const harness = createLifecycleHarness(source);

    await harness.dispatch("push", {
      data: {
        json: () => ({
          title: "Molly posted a photo.",
          url: "/family#moment-photo",
          tag: "our-days:moment:photo",
        }),
      },
    });
    expect(harness.showNotification).toHaveBeenCalledWith(
      "Molly posted a photo.",
      expect.objectContaining({
        data: { url: "/family#moment-photo" },
        tag: "our-days:moment:photo",
      }),
    );

    await harness.dispatch("notificationclick", {
      notification: {
        close: vi.fn(),
        data: { url: "/family#moment-photo" },
      },
    });
    expect(harness.openWindow).toHaveBeenCalledWith(
      "https://journal.example.com/family#moment-photo",
    );
  });
});
