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

export async function saveEntryDraftMedia(
  items: readonly EntryDraftMediaBlob[],
) {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await withStore("readwrite", async (store) => {
      for (const item of items) {
        await requestResult(store.put(item));
      }
    });
  } catch {
    return;
  }
}

export async function loadEntryDraftMedia(draftId: string) {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return [] as EntryDraftMediaBlob[];
  }
  try {
    return await withStore("readonly", async (store) => {
      const rows = await requestResult(store.getAll());
      return (rows as EntryDraftMediaBlob[]).filter(
        (row) => row.draftId === draftId,
      );
    });
  } catch {
    return [];
  }
}

export async function removeEntryDraftMedia(draftId: string) {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await withStore("readwrite", async (store) => {
      const rows = (await requestResult(
        store.getAll(),
      )) as EntryDraftMediaBlob[];
      for (const row of rows) {
        if (row.draftId === draftId) await requestResult(store.delete(row.key));
      }
    });
  } catch {
    return;
  }
}

export function entryDraftMediaKey(draftId: string, index: number) {
  return `${draftId}:${index}`;
}
