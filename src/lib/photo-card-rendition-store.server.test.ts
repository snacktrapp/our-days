// @vitest-environment node

import { createHash } from "node:crypto";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardSharpActiveCount,
  clearCardRenditionCache,
  withCardSharpPermit,
} from "@/lib/card-photo-rendition.server";
import {
  cardRenditionObjectPath,
  rememberPhotoCardRenditions,
  storePhotoCardRenditions,
} from "@/lib/photo-card-rendition-store.server";

vi.mock("server-only", () => ({}));

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
    record: async (card: {
      cardWidth: 1080 | 640;
      outputSha256Hex: string;
    }) => {
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

  it("skips the 640 card when the 1080 rendition is already over the budget", async () => {
    const widths: number[] = [];
    const stored = await storePhotoCardRenditions({
      ...ports(),
      budgetMs: 150,
      displayBytes: Uint8Array.from([1]),
      displayDerivativeId: derivativeId,
      displayObjectPath: "display/photo.webp",
      now: (() => {
        const marks = [0, 200];
        let index = 0;
        return () => marks[Math.min(index++, marks.length - 1)] ?? 200;
      })(),
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
    expect(sharp.concurrency()).toBe(1);
  });

  it("generates cards from the worker only after the display derivative completes", () => {
    const source = readFileSync(
      new URL("./photo-worker.server.ts", import.meta.url),
      "utf8",
    );
    const complete = source.indexOf("complete_photo_display_derivative");
    const remember = source.indexOf("await rememberPhotoCardRenditions");
    expect(complete).toBeGreaterThan(0);
    expect(remember).toBeGreaterThan(complete);
  });
});
