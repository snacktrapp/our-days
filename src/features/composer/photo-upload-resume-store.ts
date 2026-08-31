export const photoUploadDatabaseName = "our-days:photo-uploads";
const storeName = "attempts";

export type PhotoUploadResumeRecord = Readonly<{
  id: string;
  accountId: string;
  circleId: string;
  draftHash: string;
  fileSha256: string;
  fileSize: number;
  mimeType: string;
  requestKey: string;
  uploadRequestKey: string;
  intakeId?: string;
  momentId?: string;
  uploadUrl?: string;
  expiresAt?: string;
  acknowledged: boolean;
}>;

export type PhotoUploadResumeStore = Readonly<{
  find: (
    match: Pick<
      PhotoUploadResumeRecord,
      | "accountId"
      | "circleId"
      | "draftHash"
      | "fileSha256"
      | "fileSize"
      | "mimeType"
    >,
  ) => Promise<PhotoUploadResumeRecord | null>;
  save: (record: PhotoUploadResumeRecord) => Promise<void>;
  remove: (id: string) => Promise<void>;
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
    const request = window.indexedDB.open(photoUploadDatabaseName, 1);
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

function isExpired(record: PhotoUploadResumeRecord) {
  return Boolean(
    record.expiresAt && Date.parse(record.expiresAt) <= Date.now(),
  );
}

export const photoUploadResumeStore: PhotoUploadResumeStore = {
  async find(match) {
    return withStore("readwrite", async (store) => {
      const records = (await requestResult(
        store.getAll(),
      )) as PhotoUploadResumeRecord[];
      for (const record of records) {
        if (isExpired(record)) {
          store.delete(record.id);
          continue;
        }
        if (
          record.accountId === match.accountId &&
          record.circleId === match.circleId &&
          record.draftHash === match.draftHash &&
          record.fileSha256 === match.fileSha256 &&
          record.fileSize === match.fileSize &&
          record.mimeType === match.mimeType
        ) {
          return record;
        }
      }
      return null;
    });
  },
  async save(record) {
    await withStore("readwrite", async (store) => {
      await requestResult(store.put(record));
    });
  },
  async remove(id) {
    await withStore("readwrite", async (store) => {
      await requestResult(store.delete(id));
    });
  },
};
