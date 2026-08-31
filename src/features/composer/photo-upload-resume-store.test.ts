import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { purgeOurDaysBrowserState } from "@/lib/auth/browser-private-state";
import {
  photoUploadDatabaseName,
  photoUploadResumeStore,
  type PhotoUploadResumeRecord,
} from "./photo-upload-resume-store";

const baseRecord: PhotoUploadResumeRecord = {
  id: "resume-1",
  accountId: "account-1",
  acknowledged: false,
  circleId: "circle-1",
  draftHash: "a".repeat(64),
  fileSha256: "b".repeat(64),
  fileSize: 1_024,
  mimeType: "image/jpeg",
  requestKey: "request-1",
  uploadRequestKey: "upload-request-1",
};

function exactMatch(record = baseRecord) {
  return {
    accountId: record.accountId,
    circleId: record.circleId,
    draftHash: record.draftHash,
    fileSha256: record.fileSha256,
    fileSize: record.fileSize,
    mimeType: record.mimeType,
  };
}

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

async function storedRecords() {
  const database = await requestResult(
    window.indexedDB.open(photoUploadDatabaseName, 1),
  );
  try {
    const transaction = database.transaction("attempts", "readonly");
    return (await requestResult(
      transaction.objectStore("attempts").getAll(),
    )) as PhotoUploadResumeRecord[];
  } finally {
    database.close();
  }
}

beforeEach(() => {
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: new IDBFactory(),
  });
});

describe("photo upload resume store", () => {
  it("requires an exact account, circle, draft, file, size, and MIME match", async () => {
    await photoUploadResumeStore.save(baseRecord);

    await expect(photoUploadResumeStore.find(exactMatch())).resolves.toEqual(
      baseRecord,
    );
    for (const mismatch of [
      { accountId: "account-2" },
      { circleId: "circle-2" },
      { draftHash: "c".repeat(64) },
      { fileSha256: "d".repeat(64) },
      { fileSize: 2_048 },
      { mimeType: "image/png" },
    ]) {
      await expect(
        photoUploadResumeStore.find({ ...exactMatch(), ...mismatch }),
      ).resolves.toBeNull();
    }
  });

  it("deletes expired coordination records while searching", async () => {
    await photoUploadResumeStore.save({
      ...baseRecord,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    await expect(photoUploadResumeStore.find(exactMatch())).resolves.toBeNull();
    await expect(storedRecords()).resolves.toEqual([]);
  });

  it("lists only the current account and circle", async () => {
    await photoUploadResumeStore.save(baseRecord);
    await photoUploadResumeStore.save({
      ...baseRecord,
      id: "resume-other-account",
      accountId: "account-2",
    });
    await photoUploadResumeStore.save({
      ...baseRecord,
      id: "resume-other-circle",
      circleId: "circle-2",
    });

    await expect(
      photoUploadResumeStore.listForScope("account-1", "circle-1"),
    ).resolves.toEqual([baseRecord]);
  });

  it("retains acknowledged status records beyond upload URL expiry", async () => {
    const acknowledged = {
      ...baseRecord,
      acknowledged: true,
      expiresAt: "2000-01-01T00:00:00.000Z",
      intakeId: "intake-1",
      momentId: "moment-1",
    };
    await photoUploadResumeStore.save(acknowledged);

    await expect(photoUploadResumeStore.find(exactMatch())).resolves.toEqual(
      acknowledged,
    );
    await expect(
      photoUploadResumeStore.listForScope("account-1", "circle-1"),
    ).resolves.toEqual([acknowledged]);
  });

  it("removes an acknowledged or abandoned attempt by id", async () => {
    await photoUploadResumeStore.save(baseRecord);
    await photoUploadResumeStore.remove(baseRecord.id);

    await expect(photoUploadResumeStore.find(exactMatch())).resolves.toBeNull();
    await expect(storedRecords()).resolves.toEqual([]);
  });

  it("is deleted by the account-scoped sign-out purge", async () => {
    await photoUploadResumeStore.save(baseRecord);

    await expect(purgeOurDaysBrowserState()).resolves.toBe(true);
    await expect(window.indexedDB.databases()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: photoUploadDatabaseName }),
      ]),
    );
  });
});
