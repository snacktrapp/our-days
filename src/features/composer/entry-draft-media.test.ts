// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  entryDraftDatabaseName,
  entryDraftMediaKey,
  loadEntryDraftMedia,
  saveEntryDraftMedia,
} from "./entry-draft-media";

const draftId = "d6000000-0000-4000-8000-000000000021";

function jpegBlob() {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], {
    type: "image/jpeg",
  });
}

function mediaItem() {
  return {
    key: entryDraftMediaKey(draftId, 0),
    draftId,
    name: "porch.jpg",
    mimeType: "image/jpeg",
    blob: jpegBlob(),
  };
}

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(entryDraftDatabaseName);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
});

describe("entry draft media", () => {
  it("keeps a photo blob that can be loaded after save", async () => {
    const item = mediaItem();
    await expect(saveEntryDraftMedia([item])).resolves.toEqual({ ok: true });
    const stored = await loadEntryDraftMedia(draftId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.key).toBe(item.key);
    expect(stored[0]?.blob.size).toBe(item.blob.size);
  });

  it("fails closed when IndexedDB is missing and media was attached", async () => {
    const indexedDb = window.indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    await expect(saveEntryDraftMedia([mediaItem()])).resolves.toEqual({
      ok: false,
    });
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: indexedDb,
    });
  });

  it("fails closed when IndexedDB keeps a smaller blob than the draft attached", async () => {
    const proto = IDBObjectStore.prototype;
    const originalPut = proto.put;
    proto.put = function putDroppedBlob(value, key) {
      const row = value as { blob?: Blob };
      return originalPut.call(
        this,
        { ...row, blob: new Blob() },
        key,
      );
    };
    await expect(saveEntryDraftMedia([mediaItem()])).resolves.toEqual({
      ok: false,
    });
    proto.put = originalPut;
  });
});
