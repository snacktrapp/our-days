"use client";

import type { AccentToken } from "@/features/accent-token";
import {
  createPhotoUploadAttempt,
  PhotoUploadError,
  uploadPhotoMoment,
  type PhotoMomentDraft,
} from "./photo-upload";
import {
  createVideoUploadAttempt,
  uploadVideoMoment,
  VideoUploadError,
  type VideoMomentDraft,
} from "./video-upload";

export type OptimisticMediaUploadStage =
  | Readonly<{ state: "preparing" }>
  | Readonly<{ state: "uploading"; progress: number }>
  | Readonly<{ state: "stopping" }>
  | Readonly<{ state: "finishing" }>
  | Readonly<{ state: "processing" }>
  | Readonly<{ state: "published" }>
  | Readonly<{ state: "failed"; message: string }>;

export type OptimisticMediaUpload = Readonly<{
  id: string;
  circleId: string;
  kind: "photo" | "video";
  body: string;
  occurredOn: string;
  occurredTime: string;
  journalPersonId: string;
  journalPersonName: string;
  journalPersonInitial: string;
  journalPersonAccent: AccentToken;
  previewUrl: string;
  intakeId?: string;
  momentId?: string;
  totalFiles: number;
  completedFiles: number;
  retryable: boolean;
  stage: OptimisticMediaUploadStage;
}>;

type OptimisticPerson = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
}>;

type CommonUploadInput = Readonly<{
  file: File;
  occurredTime: string;
  person: OptimisticPerson;
}>;

export type StartPhotoUploadInput = CommonUploadInput &
  Readonly<{
    draft: PhotoMomentDraft;
    files?: readonly File[];
  }>;

export type StartVideoUploadInput = CommonUploadInput &
  Readonly<{ draft: VideoMomentDraft }>;

type QueuedUpload =
  | Readonly<{ kind: "photo"; input: StartPhotoUploadInput }>
  | Readonly<{ kind: "video"; input: StartVideoUploadInput }>;

type PhotoRetryRecord = Readonly<{
  kind: "photo";
  input: StartPhotoUploadInput;
}>;

type VideoRetryRecord = Readonly<{
  kind: "video";
  input: StartVideoUploadInput;
}>;

type RetryRecord = PhotoRetryRecord | VideoRetryRecord;

type UploadPatch = Partial<
  Pick<
    OptimisticMediaUpload,
    "intakeId" | "momentId" | "stage" | "completedFiles" | "retryable"
  >
>;

let uploads: readonly OptimisticMediaUpload[] = [];
const emptyUploads: readonly OptimisticMediaUpload[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const retryRecords = new Map<string, RetryRecord>();
const queuedUploads: QueuedUpload[] = [];
const publishedRefreshKeyPrefix = "our-days:published-photo-refresh:";
const acceptedRefreshKeyPrefix = "our-days:accepted-moment-refresh:";

function revokePreview(url: string) {
  if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

function emit() {
  for (const listener of listeners) listener();
}

function uploadStillExists(id: string) {
  return uploads.some((upload) => upload.id === id);
}

function currentUpload(id: string) {
  return uploads.find((upload) => upload.id === id);
}

function uploadErrorMessage(error: unknown, kind: "photo" | "video") {
  if (error instanceof PhotoUploadError || error instanceof VideoUploadError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Upload stopped";
  }
  return `That ${kind} could not be uploaded.`;
}

function hasActiveUploadTask() {
  return controllers.size > 0;
}

function hasBlockingFailure() {
  return uploads.some((upload) => upload.stage.state === "failed");
}

function photoFiles(input: StartPhotoUploadInput) {
  return input.files?.length ? input.files : [input.file];
}

function createOptimisticUpload(
  kind: "photo" | "video",
  input: CommonUploadInput & { draft: PhotoMomentDraft | VideoMomentDraft },
  totalFiles: number,
) {
  const id = crypto.randomUUID();
  addOptimisticMediaUpload({
    id,
    circleId: input.draft.circleId,
    kind,
    body: input.draft.body,
    occurredOn: input.draft.occurredOn,
    occurredTime: input.occurredTime,
    journalPersonId: input.person.id,
    journalPersonName: input.person.name,
    journalPersonInitial: input.person.initial,
    journalPersonAccent: input.person.accent,
    previewUrl: URL.createObjectURL(input.file),
    totalFiles,
    completedFiles: 0,
    retryable: true,
    stage: { state: "preparing" },
  });
  return id;
}

function startNextQueuedUpload() {
  if (hasActiveUploadTask() || hasBlockingFailure()) return;
  const next = queuedUploads.shift();
  if (!next) return;
  if (next.kind === "photo") {
    beginPhotoUpload(next.input);
    return;
  }
  beginVideoUpload(next.input);
}

function finishUploadTask(id: string) {
  controllers.delete(id);
  startNextQueuedUpload();
}

function runPhotoUpload(
  id: string,
  input: StartPhotoUploadInput,
  options: Readonly<{
    files: readonly File[];
    completedFiles: number;
    lastIntakeId?: string;
    lastMomentId?: string;
  }>,
) {
  const controller = new AbortController();
  controllers.set(id, controller);
  retryRecords.set(id, { kind: "photo", input });

  void (async () => {
    let lastIntakeId = options.lastIntakeId;
    let lastMomentId = options.lastMomentId;
    const totalFiles = input.files?.length ? input.files.length : 1;
    try {
      for (const [index, file] of options.files.entries()) {
        const absoluteIndex = options.completedFiles + index;
        const attempt = createPhotoUploadAttempt();
        const result = await uploadPhotoMoment(
          file,
          {
            ...input.draft,
            existingMomentId:
              absoluteIndex === 0 ? input.draft.existingMomentId : lastMomentId,
          },
          attempt,
          controller.signal,
          (stage) => {
            if (controller.signal.aborted || !uploadStillExists(id)) return;
            const progress =
              stage.state === "uploading"
                ? {
                    ...stage,
                    progress: (absoluteIndex + stage.progress) / totalFiles,
                  }
                : stage;
            updateOptimisticMediaUpload(id, {
              intakeId: attempt.intakeId,
              momentId: attempt.momentId ?? lastMomentId,
              completedFiles: absoluteIndex,
              stage: progress,
            });
          },
        );
        lastIntakeId = result.intakeId;
        lastMomentId = result.momentId;
        if (!uploadStillExists(id)) return;
        updateOptimisticMediaUpload(id, {
          intakeId: result.intakeId,
          momentId: result.momentId,
          completedFiles: absoluteIndex + 1,
          stage:
            absoluteIndex + 1 < totalFiles
              ? {
                  state: "uploading",
                  progress: (absoluteIndex + 1) / totalFiles,
                }
              : result.state === "published"
                ? { state: "published" }
                : { state: "processing" },
        });
      }
    } catch (error) {
      if (!uploadStillExists(id)) return;
      updateOptimisticMediaUpload(id, {
        intakeId: lastIntakeId,
        momentId: lastMomentId,
        stage: {
          state: "failed",
          message: uploadErrorMessage(error, "photo"),
        },
      });
    } finally {
      finishUploadTask(id);
    }
  })();

  return id;
}

function beginPhotoUpload(input: StartPhotoUploadInput) {
  const files = photoFiles(input);
  const id = createOptimisticUpload("photo", input, files.length);
  return runPhotoUpload(id, input, {
    files,
    completedFiles: 0,
  });
}

function beginVideoUpload(input: StartVideoUploadInput) {
  const id = createOptimisticUpload("video", input, 1);
  const attempt = createVideoUploadAttempt();
  const controller = new AbortController();
  controllers.set(id, controller);
  retryRecords.set(id, { kind: "video", input });

  void (async () => {
    try {
      const result = await uploadVideoMoment(
        input.file,
        input.draft,
        attempt,
        controller.signal,
        (stage) => {
          if (controller.signal.aborted || !uploadStillExists(id)) return;
          updateOptimisticMediaUpload(id, {
            momentId: attempt.momentId,
            stage,
          });
        },
      );
      if (!uploadStillExists(id)) return;
      updateOptimisticMediaUpload(id, {
        momentId: result.momentId,
        completedFiles: 1,
        stage: { state: "published" },
      });
    } catch (error) {
      if (!uploadStillExists(id)) return;
      updateOptimisticMediaUpload(id, {
        momentId: attempt.momentId,
        stage: {
          state: "failed",
          message: uploadErrorMessage(error, "video"),
        },
      });
    } finally {
      finishUploadTask(id);
    }
  })();

  return id;
}

/** Starts a photo upload independently of the composer component lifecycle. */
export function startOptimisticPhotoUpload(input: StartPhotoUploadInput) {
  if (hasActiveUploadTask() || hasBlockingFailure()) {
    queuedUploads.push({ kind: "photo", input });
    return "";
  }
  return beginPhotoUpload(input);
}

/** Starts a video upload independently of the composer component lifecycle. */
export function startOptimisticVideoUpload(input: StartVideoUploadInput) {
  if (hasActiveUploadTask() || hasBlockingFailure()) {
    queuedUploads.push({ kind: "video", input });
    return "";
  }
  return beginVideoUpload(input);
}

export function optimisticMediaUploadSnapshot() {
  return uploads;
}

export function emptyOptimisticMediaUploadSnapshot() {
  return emptyUploads;
}

export function queuedOptimisticMediaUploadCount() {
  return queuedUploads.length;
}

export function subscribeToOptimisticMediaUploads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function claimSessionFlag(prefix: string, token: string) {
  const key = `${prefix}${token}`;
  try {
    if (window.sessionStorage.getItem(key) === "1") return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

export function firstPublishedMediaRefresh(intakeId: string) {
  return claimSessionFlag(publishedRefreshKeyPrefix, intakeId);
}

export function firstAcceptedMomentRefresh(momentId: string) {
  return claimSessionFlag(acceptedRefreshKeyPrefix, momentId);
}

export function addOptimisticMediaUpload(
  upload: Omit<
    OptimisticMediaUpload,
    "totalFiles" | "completedFiles" | "retryable"
  > &
    Partial<
      Pick<OptimisticMediaUpload, "totalFiles" | "completedFiles" | "retryable">
    >,
) {
  const next: OptimisticMediaUpload = {
    totalFiles: 1,
    completedFiles: 0,
    retryable: false,
    ...upload,
  };
  const previous = uploads.find((item) => item.id === next.id);
  if (previous && previous.previewUrl !== next.previewUrl) {
    revokePreview(previous.previewUrl);
  }
  uploads = [next, ...uploads.filter((item) => item.id !== next.id)];
  emit();
}

export function updateOptimisticMediaUpload(id: string, changes: UploadPatch) {
  if (!uploadStillExists(id)) return;
  uploads = uploads.map((upload) =>
    upload.id === id ? { ...upload, ...changes } : upload,
  );
  emit();
}

export function retryOptimisticMediaUpload(id: string) {
  const upload = currentUpload(id);
  const record = retryRecords.get(id);
  if (!upload || !record || upload.stage.state !== "failed") return false;
  if (hasActiveUploadTask()) return false;

  if (record.kind === "photo") {
    const files = photoFiles(record.input);
    const remaining = files.slice(upload.completedFiles);
    if (remaining.length === 0) return false;
    updateOptimisticMediaUpload(id, {
      stage: { state: "preparing" },
      retryable: true,
    });
    runPhotoUpload(id, record.input, {
      files: remaining,
      completedFiles: upload.completedFiles,
      lastIntakeId: upload.intakeId,
      lastMomentId: upload.momentId,
    });
    return true;
  }

  updateOptimisticMediaUpload(id, {
    stage: { state: "preparing" },
    completedFiles: 0,
    retryable: true,
  });
  const attempt = createVideoUploadAttempt();
  const controller = new AbortController();
  controllers.set(id, controller);
  void (async () => {
    try {
      const result = await uploadVideoMoment(
        record.input.file,
        record.input.draft,
        attempt,
        controller.signal,
        (stage) => {
          if (controller.signal.aborted || !uploadStillExists(id)) return;
          updateOptimisticMediaUpload(id, {
            momentId: attempt.momentId ?? upload.momentId,
            stage,
          });
        },
      );
      if (!uploadStillExists(id)) return;
      updateOptimisticMediaUpload(id, {
        momentId: result.momentId,
        completedFiles: 1,
        stage: { state: "published" },
      });
    } catch (error) {
      if (!uploadStillExists(id)) return;
      updateOptimisticMediaUpload(id, {
        momentId: attempt.momentId ?? upload.momentId,
        stage: {
          state: "failed",
          message: uploadErrorMessage(error, "video"),
        },
      });
    } finally {
      finishUploadTask(id);
    }
  })();
  return true;
}

export function removeOptimisticMediaUpload(id: string) {
  const removed = uploads.find((upload) => upload.id === id);
  const hadRunningTask = controllers.has(id);
  uploads = uploads.filter((upload) => upload.id !== id);
  controllers.get(id)?.abort();
  controllers.delete(id);
  retryRecords.delete(id);
  if (removed) revokePreview(removed.previewUrl);
  emit();
  if (!hadRunningTask) startNextQueuedUpload();
}

export function removeOptimisticMediaUploadByIntake(intakeId: string) {
  const matching = uploads.find((upload) => upload.intakeId === intakeId);
  if (matching) removeOptimisticMediaUpload(matching.id);
}

/** Clears private blobs and aborts every task before an account boundary. */
export function clearOptimisticMediaUploads() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  retryRecords.clear();
  queuedUploads.length = 0;
  for (const upload of uploads) revokePreview(upload.previewUrl);
  uploads = [];
  emit();
}

// Upload tasks outlive the composer and route that created them. Keep the
// account-boundary purge at the same long-lived module scope so sign-out can
// never leave a private File, blob URL, or authorized request running.
if (typeof window !== "undefined") {
  window.addEventListener(
    "our-days:clear-private-state",
    clearOptimisticMediaUploads,
  );
}
