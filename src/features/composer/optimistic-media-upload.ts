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

let uploads: readonly OptimisticMediaUpload[] = [];
const emptyUploads: readonly OptimisticMediaUpload[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const publishedRefreshKeyPrefix = "our-days:published-photo-refresh:";

function revokePreview(url: string) {
  if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

function emit() {
  for (const listener of listeners) listener();
}

function uploadStillExists(id: string) {
  return uploads.some((upload) => upload.id === id);
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

function createOptimisticUpload(
  kind: "photo" | "video",
  input: CommonUploadInput & { draft: PhotoMomentDraft | VideoMomentDraft },
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
    stage: { state: "preparing" },
  });
  return id;
}

/** Starts a photo upload independently of the composer component lifecycle. */
export function startOptimisticPhotoUpload(input: StartPhotoUploadInput) {
  const id = createOptimisticUpload("photo", input);
  const files = input.files?.length ? input.files : [input.file];
  const controller = new AbortController();
  controllers.set(id, controller);

  void (async () => {
    let lastIntakeId: string | undefined;
    let lastMomentId: string | undefined;
    try {
      for (const [index, file] of files.entries()) {
        const attempt = createPhotoUploadAttempt();
        const result = await uploadPhotoMoment(
          file,
          {
            ...input.draft,
            existingMomentId:
              index === 0 ? input.draft.existingMomentId : lastMomentId,
          },
          attempt,
          controller.signal,
          (stage) => {
            if (controller.signal.aborted || !uploadStillExists(id)) return;
            const progress =
              stage.state === "uploading"
                ? {
                    ...stage,
                    progress: (index + stage.progress) / files.length,
                  }
                : stage;
            updateOptimisticMediaUpload(id, {
              intakeId: attempt.intakeId,
              momentId: attempt.momentId ?? lastMomentId,
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
          stage:
            index + 1 < files.length
              ? { state: "uploading", progress: (index + 1) / files.length }
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
      controllers.delete(id);
    }
  })();

  return id;
}

/** Starts a video upload independently of the composer component lifecycle. */
export function startOptimisticVideoUpload(input: StartVideoUploadInput) {
  const id = createOptimisticUpload("video", input);
  const attempt = createVideoUploadAttempt();
  const controller = new AbortController();
  controllers.set(id, controller);

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
      controllers.delete(id);
    }
  })();

  return id;
}

export function optimisticMediaUploadSnapshot() {
  return uploads;
}

export function emptyOptimisticMediaUploadSnapshot() {
  return emptyUploads;
}

export function subscribeToOptimisticMediaUploads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function firstPublishedMediaRefresh(intakeId: string) {
  const key = `${publishedRefreshKeyPrefix}${intakeId}`;
  try {
    if (window.sessionStorage.getItem(key) === "1") return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

export function addOptimisticMediaUpload(upload: OptimisticMediaUpload) {
  const previous = uploads.find((item) => item.id === upload.id);
  if (previous && previous.previewUrl !== upload.previewUrl) {
    revokePreview(previous.previewUrl);
  }
  uploads = [upload, ...uploads.filter((item) => item.id !== upload.id)];
  emit();
}

export function updateOptimisticMediaUpload(
  id: string,
  changes: Partial<
    Pick<OptimisticMediaUpload, "intakeId" | "momentId" | "stage">
  >,
) {
  if (!uploadStillExists(id)) return;
  uploads = uploads.map((upload) =>
    upload.id === id ? { ...upload, ...changes } : upload,
  );
  emit();
}

export function removeOptimisticMediaUpload(id: string) {
  const removed = uploads.find((upload) => upload.id === id);
  uploads = uploads.filter((upload) => upload.id !== id);
  controllers.get(id)?.abort();
  controllers.delete(id);
  if (removed) revokePreview(removed.previewUrl);
  emit();
}

export function removeOptimisticMediaUploadByIntake(intakeId: string) {
  const matching = uploads.find((upload) => upload.intakeId === intakeId);
  if (matching) removeOptimisticMediaUpload(matching.id);
}

/** Clears private blobs and aborts every task before an account boundary. */
export function clearOptimisticMediaUploads() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
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
