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
import { inspectVideoFile } from "@/features/video/inspect-video-file";
import {
  rememberVideoFrame,
  rememberVideoPoster,
} from "@/features/video/video-poster-store";
import { persistVideoPoster } from "@/features/video/persist-video-poster";
import {
  clearFailedMediaUploadDrafts,
  loadFailedMediaUploadDrafts,
  removeFailedMediaUploadDraft,
  saveFailedMediaUploadDraft,
  type FailedMediaUploadDraft,
} from "./failed-media-upload-store";

export type OptimisticMediaUploadStage =
  | Readonly<{ state: "preparing" }>
  | Readonly<{ state: "uploading"; progress: number; retrying?: boolean }>
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
  audience: "family" | "just_me";
  /** False when media is added to a moment that already exists. */
  created: boolean;
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
  Readonly<{
    draft: Omit<VideoMomentDraft, "durationMs"> & { durationMs?: number };
    posterDataUrl?: string;
    width?: number;
    height?: number;
  }>;

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
const restoredUploadIds = new Set<string>();
let restoreTask: Promise<void> | null = null;
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

function uploadFailureIsRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const status =
    typeof error === "object" && error && "status" in error
      ? Number(error.status)
      : Number.NaN;
  if (
    status === 403 ||
    code === "42501" ||
    /42501|permission denied/iu.test(`${code} ${message}`)
  ) {
    return true;
  }
  if (error instanceof PhotoUploadError || error instanceof VideoUploadError) {
    return error.retryable;
  }
  return true;
}

function fileRecord(file: File) {
  return { name: file.name, mimeType: file.type, blob: file };
}

function persistFailedUpload(id: string) {
  const upload = currentUpload(id);
  const record = retryRecords.get(id);
  if (!upload || !record || upload.stage.state !== "failed") return;
  const files =
    record.kind === "photo" ? photoFiles(record.input) : [record.input.file];
  const draft = record.input.draft;
  const persisted: FailedMediaUploadDraft = {
    id,
    kind: record.kind,
    circleId: upload.circleId,
    body: draft.body,
    occurredOn: draft.occurredOn,
    occurredAt: draft.occurredAt,
    occurredTimezone: draft.occurredTimezone,
    occurredTime: record.input.occurredTime,
    placeName: draft.placeName,
    latitude: draft.latitude ?? null,
    longitude: draft.longitude ?? null,
    taggedPersonIds: [...draft.taggedPersonIds],
    audience: upload.audience,
    circleIds: [...(draft.circleIds ?? [])],
    existingMomentId:
      "existingMomentId" in draft ? draft.existingMomentId : undefined,
    mentions: [...(draft.mentions ?? [])],
    journalPersonId: upload.journalPersonId,
    journalPersonName: upload.journalPersonName,
    journalPersonInitial: upload.journalPersonInitial,
    journalPersonAccent: upload.journalPersonAccent,
    created: upload.created,
    message: upload.stage.message,
    retryable: upload.retryable,
    completedFiles: upload.completedFiles,
    intakeId: upload.intakeId,
    momentId: upload.momentId,
    files: files.map(fileRecord),
    durationMs:
      record.kind === "video" ? record.input.draft.durationMs : undefined,
    posterDataUrl:
      record.kind === "video" ? record.input.posterDataUrl : undefined,
    width: record.kind === "video" ? record.input.width : undefined,
    height: record.kind === "video" ? record.input.height : undefined,
  };
  void saveFailedMediaUploadDraft(persisted).catch(() => undefined);
}

function forgetFailedUpload(id: string) {
  restoredUploadIds.add(id);
  void removeFailedMediaUploadDraft(id).catch(() => undefined);
}

export function restoreFailedMediaUploads() {
  if (restoreTask) return restoreTask;
  restoreTask = (async () => {
    let drafts: readonly FailedMediaUploadDraft[] = [];
    try {
      drafts = await loadFailedMediaUploadDrafts();
    } catch {
      return;
    }
    for (const draft of drafts) {
      if (restoredUploadIds.has(draft.id) || uploadStillExists(draft.id)) {
        continue;
      }
      restoredUploadIds.add(draft.id);
      const files = draft.files.map(
        (file) =>
          new File([file.blob], file.name || "upload", {
            type: file.mimeType || "application/octet-stream",
          }),
      );
      const previewSource =
        files[Math.min(draft.completedFiles, files.length - 1)] ?? files[0];
      if (!previewSource) continue;
      const person = {
        id: draft.journalPersonId,
        name: draft.journalPersonName,
        initial: draft.journalPersonInitial,
        accent: draft.journalPersonAccent,
      };
      addOptimisticMediaUpload({
        id: draft.id,
        circleId: draft.circleId,
        kind: draft.kind,
        body: draft.body,
        occurredOn: draft.occurredOn,
        occurredTime: draft.occurredTime,
        journalPersonId: person.id,
        journalPersonName: person.name,
        journalPersonInitial: person.initial,
        journalPersonAccent: person.accent,
        audience: draft.audience,
        created: draft.created,
        previewUrl: URL.createObjectURL(previewSource),
        intakeId: draft.intakeId,
        momentId: draft.momentId,
        totalFiles: files.length,
        completedFiles: draft.completedFiles,
        retryable: draft.retryable,
        stage: { state: "failed", message: draft.message },
      });
      if (draft.kind === "photo") {
        retryRecords.set(draft.id, {
          kind: "photo",
          input: {
            file: files[0]!,
            files,
            occurredTime: draft.occurredTime,
            person,
            draft: {
              body: draft.body,
              circleId: draft.circleId,
              journalPersonId: draft.journalPersonId,
              occurredAt: draft.occurredAt,
              occurredOn: draft.occurredOn,
              occurredTimezone: draft.occurredTimezone,
              placeName: draft.placeName,
              latitude: draft.latitude,
              longitude: draft.longitude,
              taggedPersonIds: draft.taggedPersonIds,
              audience: draft.audience,
              circleIds: draft.circleIds,
              existingMomentId: draft.existingMomentId,
              mentions: draft.mentions,
            },
          },
        });
        continue;
      }
      retryRecords.set(draft.id, {
        kind: "video",
        input: {
          file: files[0]!,
          occurredTime: draft.occurredTime,
          person,
          posterDataUrl: draft.posterDataUrl,
          width: draft.width,
          height: draft.height,
          draft: {
            body: draft.body,
            circleId: draft.circleId,
            durationMs: draft.durationMs ?? 0,
            journalPersonId: draft.journalPersonId,
            occurredAt: draft.occurredAt,
            occurredOn: draft.occurredOn,
            occurredTimezone: draft.occurredTimezone,
            placeName: draft.placeName,
            latitude: draft.latitude,
            longitude: draft.longitude,
            taggedPersonIds: draft.taggedPersonIds,
            audience: draft.audience,
            circleIds: draft.circleIds,
            mentions: draft.mentions,
          },
        },
      });
    }
  })().finally(() => {
    restoreTask = null;
  });
  return restoreTask;
}

function failUpload(
  id: string,
  error: unknown,
  kind: "photo" | "video",
  patch: UploadPatch,
) {
  updateOptimisticMediaUpload(id, {
    ...patch,
    retryable: uploadFailureIsRetryable(error),
    stage: { state: "failed", message: uploadErrorMessage(error, kind) },
  });
  persistFailedUpload(id);
  restoredUploadIds.add(id);
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
  input: CommonUploadInput & {
    draft: {
      circleId: string;
      body: string;
      occurredOn: string;
      audience?: "family" | "just_me";
      existingMomentId?: string;
    };
  },
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
    audience: input.draft.audience === "just_me" ? "just_me" : "family",
    created: !input.draft.existingMomentId,
    previewUrl: URL.createObjectURL(input.file),
    totalFiles,
    completedFiles: 0,
    retryable: true,
    stage: { state: "preparing" },
  });
  return id;
}

function clearFailedUploadQueue() {
  if (queuedUploads.length === 0) return;
  queuedUploads.length = 0;
  emit();
}

function startNextQueuedUpload() {
  if (hasActiveUploadTask() || hasBlockingFailure()) return;
  const next = queuedUploads.shift();
  if (!next) return;
  emit();
  if (next.kind === "photo") {
    beginPhotoUpload(next.input);
    return;
  }
  beginVideoUpload(next.input);
}

function finishUploadTask(id: string) {
  controllers.delete(id);
  if (hasBlockingFailure()) {
    // A failed chip must not keep an invisible follow-up ready to fire
    // when the family later dismisses or retries the failure.
    clearFailedUploadQueue();
    return;
  }
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
            announcePublication: absoluteIndex === 0,
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
      forgetFailedUpload(id);
    } catch (error) {
      if (!uploadStillExists(id)) return;
      failUpload(id, error, "photo", {
        intakeId: lastIntakeId,
        momentId: lastMomentId,
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

function rememberPoster(
  momentId: string | undefined,
  posterDataUrl?: string,
  width?: number,
  height?: number,
) {
  if (momentId && posterDataUrl) rememberVideoPoster(momentId, posterDataUrl);
  if (momentId && width && height) rememberVideoFrame(momentId, width, height);
}

async function preparedVideoDraft(
  input: StartVideoUploadInput,
  signal: AbortSignal,
) {
  let durationMs = input.draft.durationMs;
  let posterDataUrl = input.posterDataUrl;
  let width = input.width;
  let height = input.height;
  if (!durationMs || !posterDataUrl || !width || !height) {
    const inspected = await inspectVideoFile(input.file, signal);
    durationMs = durationMs ?? inspected.durationMs;
    posterDataUrl = posterDataUrl ?? inspected.posterDataUrl ?? undefined;
    width = width ?? inspected.width;
    height = height ?? inspected.height;
  }
  return {
    draft: { ...input.draft, durationMs },
    posterDataUrl,
    width,
    height,
  };
}

function beginVideoUpload(input: StartVideoUploadInput) {
  const id = createOptimisticUpload("video", input, 1);
  const attempt = createVideoUploadAttempt();
  const controller = new AbortController();
  controllers.set(id, controller);
  retryRecords.set(id, { kind: "video", input });

  void (async () => {
    try {
      const prepared = await preparedVideoDraft(input, controller.signal);
      const result = await uploadVideoMoment(
        input.file,
        prepared.draft,
        attempt,
        controller.signal,
        (stage) => {
          if (controller.signal.aborted || !uploadStillExists(id)) return;
          rememberPoster(
            attempt.momentId,
            prepared.posterDataUrl,
            prepared.width,
            prepared.height,
          );
          updateOptimisticMediaUpload(id, {
            momentId: attempt.momentId,
            stage,
          });
        },
        {},
        prepared.posterDataUrl && prepared.width && prepared.height
          ? {
              dataUrl: prepared.posterDataUrl,
              width: prepared.width,
              height: prepared.height,
            }
          : undefined,
      );
      if (!uploadStillExists(id)) return;
      rememberPoster(
        result.momentId,
        prepared.posterDataUrl,
        prepared.width,
        prepared.height,
      );
      if (prepared.posterDataUrl && prepared.width && prepared.height) {
        void persistVideoPoster({
          momentId: result.momentId,
          posterDataUrl: prepared.posterDataUrl,
          width: prepared.width,
          height: prepared.height,
        });
      }
      updateOptimisticMediaUpload(id, {
        momentId: result.momentId,
        completedFiles: 1,
        stage: { state: "published" },
      });
      forgetFailedUpload(id);
    } catch (error) {
      if (!uploadStillExists(id)) return;
      failUpload(id, error, "video", { momentId: attempt.momentId });
    } finally {
      finishUploadTask(id);
    }
  })();

  return id;
}

/** Starts a photo upload independently of the composer component lifecycle. */
export function startOptimisticPhotoUpload(input: StartPhotoUploadInput) {
  // Queue only behind an in-flight upload. A failed chip must not hide the
  // next post — start it so the family sees a chip instead of a silent queue.
  if (hasActiveUploadTask()) {
    queuedUploads.push({ kind: "photo", input });
    emit();
    return "";
  }
  return beginPhotoUpload(input);
}

/** Starts a video upload independently of the composer component lifecycle. */
export function startOptimisticVideoUpload(input: StartVideoUploadInput) {
  if (hasActiveUploadTask()) {
    queuedUploads.push({ kind: "video", input });
    emit();
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

export function queuedOptimisticMediaUploadCount(circleId?: string) {
  if (!circleId) return queuedUploads.length;
  return queuedUploads.filter(
    (upload) => upload.input.draft.circleId === circleId,
  ).length;
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
    "totalFiles" | "completedFiles" | "retryable" | "audience" | "created"
  > &
    Partial<
      Pick<
        OptimisticMediaUpload,
        "totalFiles" | "completedFiles" | "retryable" | "audience" | "created"
      >
    >,
) {
  const next: OptimisticMediaUpload = {
    totalFiles: 1,
    completedFiles: 0,
    retryable: false,
    audience: "family",
    created: true,
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
  const next = uploads.find((upload) => upload.id === id);
  if (next?.stage.state === "failed") persistFailedUpload(id);
  if (next?.stage.state === "published") forgetFailedUpload(id);
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
      const prepared = await preparedVideoDraft(
        record.input,
        controller.signal,
      );
      const result = await uploadVideoMoment(
        record.input.file,
        prepared.draft,
        attempt,
        controller.signal,
        (stage) => {
          if (controller.signal.aborted || !uploadStillExists(id)) return;
          rememberPoster(
            attempt.momentId ?? upload.momentId,
            prepared.posterDataUrl,
            prepared.width,
            prepared.height,
          );
          updateOptimisticMediaUpload(id, {
            momentId: attempt.momentId ?? upload.momentId,
            stage,
          });
        },
        {},
        prepared.posterDataUrl && prepared.width && prepared.height
          ? {
              dataUrl: prepared.posterDataUrl,
              width: prepared.width,
              height: prepared.height,
            }
          : undefined,
      );
      if (!uploadStillExists(id)) return;
      rememberPoster(
        result.momentId,
        prepared.posterDataUrl,
        prepared.width,
        prepared.height,
      );
      if (prepared.posterDataUrl && prepared.width && prepared.height) {
        void persistVideoPoster({
          momentId: result.momentId,
          posterDataUrl: prepared.posterDataUrl,
          width: prepared.width,
          height: prepared.height,
        });
      }
      updateOptimisticMediaUpload(id, {
        momentId: result.momentId,
        completedFiles: 1,
        stage: { state: "published" },
      });
      forgetFailedUpload(id);
    } catch (error) {
      if (!uploadStillExists(id)) return;
      failUpload(id, error, "video", {
        momentId: attempt.momentId ?? upload.momentId,
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
  const wasFailed = removed?.stage.state === "failed";
  uploads = uploads.filter((upload) => upload.id !== id);
  controllers.get(id)?.abort();
  controllers.delete(id);
  retryRecords.delete(id);
  forgetFailedUpload(id);
  if (removed) revokePreview(removed.previewUrl);
  if (wasFailed) clearFailedUploadQueue();
  emit();
  if (!hadRunningTask && !wasFailed) startNextQueuedUpload();
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
  restoredUploadIds.clear();
  void clearFailedMediaUploadDrafts().catch(() => undefined);
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
  void restoreFailedMediaUploads();
}
