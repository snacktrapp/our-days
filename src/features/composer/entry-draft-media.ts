"use client";

export const entryDraftDatabaseName = "our-days:drafts";
const storeName = "media";

export type EntryDraftMediaBlob = Readonly<{
  key: string;
  draftId: string;
  name: string;
  mimeType: string;
  blob: Blob;
}>;

type StoredDraftMedia = Readonly<{
  key: string;
  draftId: string;
  name: string;
  mimeType: string;
  bytes?: ArrayBuffer;
  blob?: Blob;
}>;

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(entryDraftDatabaseName, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: "key" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const completed = new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
    });
    const result = await operation(transaction.objectStore(storeName));
    await completed;
    return result;
  } finally {
    database.close();
  }
}

function byteLengthOf(value: unknown) {
  if (!value || typeof value !== "object" || !("byteLength" in value)) {
    return null;
  }
  const length = (value as { byteLength: unknown }).byteLength;
  return typeof length === "number" ? length : null;
}

function storedByteLength(row: StoredDraftMedia) {
  return (
    byteLengthOf(row.bytes) ?? (row.blob instanceof Blob ? row.blob.size : null)
  );
}

function bytesToBlob(bytes: unknown, mimeType: string) {
  const length = byteLengthOf(bytes);
  if (length == null) return null;
  return new Blob([new Uint8Array(bytes as ArrayBuffer)], { type: mimeType });
}

function rowFromStored(row: StoredDraftMedia): EntryDraftMediaBlob | null {
  const blob =
    bytesToBlob(row.bytes, row.mimeType) ??
    (row.blob instanceof Blob ? row.blob : null);
  if (!blob) return null;
  return {
    key: row.key,
    draftId: row.draftId,
    name: row.name,
    mimeType: row.mimeType,
    blob,
  };
}

export async function saveEntryDraftMedia(
  items: readonly EntryDraftMediaBlob[],
): Promise<{ ok: boolean }> {
  if (items.length === 0) return { ok: true };
  if (typeof window === "undefined" || !window.indexedDB) {
    return { ok: false };
  }
  try {
    const records = await Promise.all(
      items.map(async (item) => ({
        key: item.key,
        draftId: item.draftId,
        name: item.name,
        mimeType: item.mimeType,
        bytes: await item.blob.arrayBuffer(),
      })),
    );
    await withStore("readwrite", async (store) => {
      await Promise.all(
        records.map((record) => requestResult(store.put(record))),
      );
    });
    const stored = await withStore("readonly", async (store) => {
      return (await requestResult(store.getAll())) as StoredDraftMedia[];
    });
    const missing = records.some(
      (record) =>
        !stored.some(
          (row) =>
            row.key === record.key &&
            storedByteLength(row) === record.bytes.byteLength,
        ),
    );
    return missing ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function loadEntryDraftMedia(draftId: string) {
  if (typeof window === "undefined" || !window.indexedDB) {
    return [] as EntryDraftMediaBlob[];
  }
  try {
    return await withStore("readonly", async (store) => {
      const rows = (await requestResult(store.getAll())) as StoredDraftMedia[];
      return rows.flatMap((row) => {
        if (row.draftId !== draftId) return [];
        const next = rowFromStored(row);
        return next ? [next] : [];
      });
    });
  } catch {
    return [];
  }
}

export async function removeEntryDraftMedia(draftId: string) {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    await withStore("readwrite", async (store) => {
      const rows = (await requestResult(store.getAll())) as StoredDraftMedia[];
      await Promise.all(
        rows
          .filter((row) => row.draftId === draftId)
          .map((row) => requestResult(store.delete(row.key))),
      );
    });
  } catch {
    return;
  }
}

export function entryDraftMediaKey(draftId: string, index: number) {
  return `${draftId}:${index}`;
}
