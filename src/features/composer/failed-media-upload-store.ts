"use client";

import type { AccentToken } from "@/features/accent-token";

export const failedMediaUploadDatabaseName = "our-days:failed-media-uploads";
const storeName = "drafts";

export type FailedMediaMention = Readonly<{
  userId: string;
  start: number;
  end: number;
}>;

export type FailedMediaFile = Readonly<{
  name: string;
  mimeType: string;
  blob: Blob;
}>;

export type FailedMediaUploadDraft = Readonly<{
  id: string;
  kind: "photo" | "video";
  circleId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  occurredTime: string;
  placeName: string;
  latitude: number | null;
  longitude: number | null;
  taggedPersonIds: readonly string[];
  audience: "family" | "just_me";
  circleIds: readonly string[];
  existingMomentId?: string;
  mentions: readonly FailedMediaMention[];
  journalPersonId: string;
  journalPersonName: string;
  journalPersonInitial: string;
  journalPersonAccent: AccentToken;
  created: boolean;
  message: string;
  retryable: boolean;
  completedFiles: number;
  intakeId?: string;
  momentId?: string;
  files: readonly FailedMediaFile[];
  durationMs?: number;
  posterDataUrl?: string;
  width?: number;
  height?: number;
}>;

type StoredFile = Readonly<{
  name: string;
  mimeType: string;
  bytes?: ArrayBuffer;
  blob?: Blob;
}>;

type StoredDraft = Omit<
  FailedMediaUploadDraft,
  "files" | "mentions" | "taggedPersonIds" | "circleIds"
> &
  Readonly<{
    mentions?: readonly FailedMediaMention[];
    taggedPersonIds?: readonly string[];
    circleIds?: readonly string[];
    files: readonly StoredFile[];
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
    const request = window.indexedDB.open(failedMediaUploadDatabaseName, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: "id" });
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
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
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

function bytesToBlob(bytes: unknown, mimeType: string) {
  if (!bytes || typeof bytes !== "object" || !("byteLength" in bytes)) {
    return null;
  }
  const length = (bytes as { byteLength: unknown }).byteLength;
  if (typeof length !== "number") return null;
  return new Blob([new Uint8Array(bytes as ArrayBuffer)], { type: mimeType });
}

function fileFromStored(file: StoredFile): FailedMediaFile | null {
  const blob =
    bytesToBlob(file.bytes, file.mimeType) ??
    (file.blob instanceof Blob ? file.blob : null);
  if (!blob || blob.size < 1) return null;
  return { name: file.name, mimeType: file.mimeType, blob };
}

function draftFromStored(row: StoredDraft): FailedMediaUploadDraft | null {
  if (!row?.id || (row.kind !== "photo" && row.kind !== "video")) return null;
  const files = (row.files ?? []).flatMap((file) => {
    const next = fileFromStored(file);
    return next ? [next] : [];
  });
  if (files.length === 0) return null;
  return {
    id: row.id,
    kind: row.kind,
    circleId: row.circleId,
    body: row.body ?? "",
    occurredOn: row.occurredOn,
    occurredAt: row.occurredAt ?? null,
    occurredTimezone: row.occurredTimezone ?? null,
    occurredTime: row.occurredTime ?? "",
    placeName: row.placeName ?? "",
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    taggedPersonIds: [...(row.taggedPersonIds ?? [])],
    audience: row.audience === "just_me" ? "just_me" : "family",
    circleIds: [...(row.circleIds ?? [])],
    existingMomentId: row.existingMomentId,
    mentions: [...(row.mentions ?? [])],
    journalPersonId: row.journalPersonId,
    journalPersonName: row.journalPersonName,
    journalPersonInitial: row.journalPersonInitial,
    journalPersonAccent: row.journalPersonAccent,
    created: row.created !== false,
    message: row.message || "That upload could not be finished.",
    retryable: row.retryable !== false,
    completedFiles: row.completedFiles ?? 0,
    intakeId: row.intakeId,
    momentId: row.momentId,
    files,
    durationMs: row.durationMs,
    posterDataUrl: row.posterDataUrl,
    width: row.width,
    height: row.height,
  };
}

function databaseAvailable() {
  return typeof window !== "undefined" && Boolean(window.indexedDB);
}

export async function saveFailedMediaUploadDraft(
  draft: FailedMediaUploadDraft,
) {
  if (!databaseAvailable() || draft.files.length === 0) return;
  const files = await Promise.all(
    draft.files.map(async (file) => ({
      name: file.name,
      mimeType: file.mimeType,
      bytes: await file.blob.arrayBuffer(),
    })),
  );
  if (files.some((file) => file.bytes.byteLength < 1)) return;
  await withStore("readwrite", async (store) => {
    await requestResult(
      store.put({
        ...draft,
        mentions: [...draft.mentions],
        taggedPersonIds: [...draft.taggedPersonIds],
        circleIds: [...draft.circleIds],
        files,
      }),
    );
  });
}

export async function loadFailedMediaUploadDrafts() {
  if (!databaseAvailable()) return [] as FailedMediaUploadDraft[];
  const rows = await withStore("readonly", async (store) => {
    return (await requestResult(store.getAll())) as StoredDraft[];
  });
  return rows.flatMap((row) => {
    const draft = draftFromStored(row);
    return draft ? [draft] : [];
  });
}

export async function removeFailedMediaUploadDraft(id: string) {
  if (!databaseAvailable()) return;
  await withStore("readwrite", async (store) => {
    await requestResult(store.delete(id));
  });
}

export async function clearFailedMediaUploadDrafts() {
  if (!databaseAvailable()) return;
  await withStore("readwrite", async (store) => {
    await requestResult(store.clear());
  });
}
