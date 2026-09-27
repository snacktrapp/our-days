// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardSharpActiveCount,
  clearCardRenditionCache,
  renderCardPhoto,
  withCardSharpPermit,
} from "@/lib/card-photo-rendition.server";
import {
  cardRenditionObjectPath,
  rememberPhotoCardRenditions,
  runPhotoCardRenditions,
  schedulePhotoCardRenditions,
  storePhotoCardRenditions,
} from "@/lib/photo-card-rendition-store.server";

const scheduled = vi.hoisted(() => ({
  tasks: [] as Array<() => unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    scheduled.tasks.push(callback);
  },
}));

const derivativeId = "10000000-0000-4000-8000-0000000000c1";
const originalId = "10000000-0000-4000-8000-0000000000c2";

function ports() {
  const objects = new Map<string, Uint8Array>();
  const recorded: Array<{ path: string; sha: string; width: number }> = [];
  return {
    objects,
    recorded,
    identity: async (path: string) => {
      if (!objects.has(path)) throw new Error("missing");
      return { id: `object-${recorded.length + 1}`, version: "v1" };
    },
    readBack: async (path: string) => {
      const bytes = objects.get(path);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
    record: async (card: { cardWidth: 1080; outputSha256Hex: string }) => {
      recorded.push({
        path: cardRenditionObjectPath("display/photo.webp", card.cardWidth),
        sha: card.outputSha256Hex,
        width: card.cardWidth,
      });
    },
    upload: async (path: string, bytes: Uint8Array) => {
      objects.set(path, bytes);
    },
  };
}

async function displayBytes() {
  return new Uint8Array(
    await sharp({
      create: {
        background: { b: 40, g: 90, r: 180 },
        channels: 3,
        height: 900,
        width: 1400,
      },
    })
      .webp()
      .toBuffer(),
  );
}

describe("card renditions stored after a display derivative", () => {
  afterEach(() => {
    clearCardRenditionCache();
    vi.restoreAllMocks();
  });

  it("stores a 1080 card after a new upload commits its display derivative", async () => {
    const io = ports();
    const stored = await storePhotoCardRenditions({
      ...io,
      displayBytes: await displayBytes(),
      displayDerivativeId: derivativeId,
      displayObjectPath: "display/photo.webp",
      originalId,
    });
    expect(stored).toContain(1080);
    const card = io.recorded.find((row) => row.width === 1080);
    expect(card?.path).toBe("display/photo.webp.card-1080.webp");
    const bytes = io.objects.get(card?.path ?? "");
    expect(bytes && createHash("sha256").update(bytes).digest("hex")).toBe(
      card?.sha,
    );
    const meta = await sharp(Buffer.from(bytes ?? [])).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(1080);
    expect(meta.exif).toBeUndefined();
  });

  it("stores a 1080 card after edit-add-photo commits its display derivative", async () => {
    const io = ports();
    const path = "display/added.webp";
    const stored = await storePhotoCardRenditions({
      ...io,
      displayBytes: await displayBytes(),
      displayDerivativeId: "10000000-0000-4000-8000-0000000000c3",
      displayObjectPath: path,
      originalId: "10000000-0000-4000-8000-0000000000c4",
      record: async (card) => {
        io.recorded.push({
          path: cardRenditionObjectPath(path, card.cardWidth),
          sha: card.outputSha256Hex,
          width: card.cardWidth,
        });
      },
    });
    expect(stored).toContain(1080);
    expect(
      io.recorded.some((row) => row.path.endsWith(".card-1080.webp")),
    ).toBe(true);
  });

  it("stores only the 1080 card", async () => {
    const widths: number[] = [];
    const stored = await storePhotoCardRenditions({
      ...ports(),
      displayBytes: Uint8Array.from([1]),
      displayDerivativeId: derivativeId,
      displayObjectPath: "display/photo.webp",
      originalId,
      render: async (_bytes, width) => {
        widths.push(width);
        return { bytes: Uint8Array.from([9, 8, 7]), height: 2, width: 2 };
      },
    });
    expect(widths).toEqual([1080]);
    expect(stored).toEqual([1080]);
  });

  it("still succeeds when card generation throws", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await expect(
      rememberPhotoCardRenditions(async () => {
        throw new Error("sharp failed");
      }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("runs at most two card sharp operations at once", async () => {
    let active = 0;
    let peak = 0;
    const gate = Promise.withResolvers<void>();
    const tasks = Array.from({ length: 4 }, () =>
      withCardSharpPermit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );
    await vi.waitFor(() => {
      expect(cardSharpActiveCount()).toBe(2);
    });
    expect(peak).toBe(2);
    gate.resolve();
    await Promise.all(tasks);
    expect(cardSharpActiveCount()).toBe(0);
  });

  it("does not set a process-wide sharp concurrency limit", () => {
    const server = readFileSync(
      new URL("./card-photo-rendition.server.ts", import.meta.url),
      "utf8",
    );
    const shared = readFileSync(
      new URL("../../scripts/lib/card-photo-rendition.mjs", import.meta.url),
      "utf8",
    );
    expect(server).not.toContain("sharp.concurrency");
    expect(shared).not.toContain("sharp.concurrency");
    expect(server).toContain("withCardSharpPermit");
  });

  it("schedules card generation outside the processing response", () => {
    const source = readFileSync(
      new URL("./photo-worker.server.ts", import.meta.url),
      "utf8",
    );
    const complete = source.indexOf("complete_photo_display_derivative");
    const callbackReturn = source.indexOf(
      "return {\n              derivativeId,",
    );
    const schedule = source.indexOf("schedulePhotoCardRenditions(");
    expect(complete).toBeGreaterThan(0);
    expect(callbackReturn).toBeGreaterThan(complete);
    expect(schedule).toBeGreaterThan(callbackReturn);
    expect(source).not.toMatch(/await\s+schedulePhotoCardRenditions/);
    expect(source).not.toContain("await rememberPhotoCardRenditions");
  });

  it("does not await card generation, and a hanging upload does not delay it", async () => {
    scheduled.tasks.length = 0;
    let started = false;
    const hang = () =>
      new Promise<void>(() => {
        started = true;
      });
    const began = performance.now();
    schedulePhotoCardRenditions(hang);
    expect(performance.now() - began).toBeLessThan(50);
    expect(started).toBe(false);
    expect(scheduled.tasks).toHaveLength(1);

    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const winner = await Promise.race([
      runPhotoCardRenditions(hang, 30).then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 200)),
    ]);
    expect(winner).toBe("settled");
    expect(started).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  it("counts permit wait separately from resize", async () => {
    const gate = Promise.withResolvers<void>();
    const blockers = Array.from({ length: 2 }, () =>
      withCardSharpPermit(() => gate.promise),
    );
    await vi.waitFor(() => {
      expect(cardSharpActiveCount()).toBe(2);
    });
    const pending = renderCardPhoto(Uint8Array.from([1, 2, 3]), 1080);
    await new Promise((resolve) => setTimeout(resolve, 40));
    gate.resolve();
    const rendered = await pending;
    await Promise.all(blockers);
    expect(rendered.queueMs).toBeGreaterThanOrEqual(30);
  });
});
