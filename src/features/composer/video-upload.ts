import { resolveSupabaseOrigin } from "../../../config/supabase-origin";
import type {
  DetailedError,
  HttpRequest,
  Upload as TusUpload,
} from "tus-js-client";
import { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import {
  readOptionalSupabasePublicConfig,
  readSupabasePublicConfig,
} from "@/lib/supabase/public-config";

export const maximumVideoBytes = 100 * 1024 * 1024;
export const maximumVideoDurationMs = 60_500;

const allowedVideoTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);
const extensionMimeTypes: Readonly<Record<string, string>> = {
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mp4: "video/mp4",
  webm: "video/webm",
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type VideoUploadStage =
  | Readonly<{ state: "preparing" }>
  | Readonly<{ state: "uploading"; progress: number }>
  | Readonly<{ state: "stopping" }>
  | Readonly<{ state: "finishing" }>;

export type VideoUploadAttempt = {
  requestKey: string;
  requestId?: string;
  momentId?: string;
  uploadUrl?: string;
};

export type VideoMomentDraft = Readonly<{
  body: string;
  circleId: string;
  durationMs: number;
  journalPersonId: string;
  occurredAt: string | null;
  occurredOn: string;
  occurredTimezone: string | null;
  placeName: string;
  taggedPersonIds: readonly string[];
}>;

export class VideoUploadError extends Error {
  readonly retryable: boolean;
  readonly discardUpload: boolean;

  constructor(message: string, retryable = true, discardUpload = false) {
    super(message);
    this.name = "VideoUploadError";
    this.retryable = retryable;
    this.discardUpload = discardUpload;
  }
}

type UploadDependencies = Readonly<{
  createClient?: typeof createOurDaysBrowserClient;
  upload?: typeof uploadWithTusClient;
}>;

export function createVideoUploadAttempt(): VideoUploadAttempt {
  return { requestKey: crypto.randomUUID() };
}

export function acceptedVideoMime(file: File) {
  const declared = file.type.trim().toLowerCase();
  if (declared) return allowedVideoTypes.has(declared) ? declared : null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return extensionMimeTypes[extension] ?? null;
}

function inspectVideo(file: File, durationMs: number) {
  const mimeType = acceptedVideoMime(file);
  if (!mimeType) {
    throw new VideoUploadError(
      "Choose an MP4, MOV, M4V, or WebM video.",
      false,
    );
  }
  if (file.size < 1) {
    throw new VideoUploadError(
      "That video is empty. Choose another one.",
      false,
    );
  }
  if (file.size > maximumVideoBytes) {
    throw new VideoUploadError("Choose a video smaller than 100 MB.", false);
  }
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > maximumVideoDurationMs
  ) {
    throw new VideoUploadError(
      "Choose a video about 60 seconds or shorter.",
      false,
    );
  }
  return mimeType;
}

function resumableEndpoint(supabaseUrl: string) {
  const origin = resolveSupabaseOrigin(supabaseUrl);
  return `${origin.storageHttp ?? origin.http}/storage/v1/upload/resumable`;
}

function resolvedUploadUrl(endpoint: string, location: string | null) {
  if (!location) throw new VideoUploadError("The upload could not be started.");
  const resolved = new URL(location, endpoint);
  const expected = new URL(endpoint);
  if (
    resolved.origin !== expected.origin ||
    !resolved.pathname.startsWith(`${expected.pathname}/`) ||
    resolved.username ||
    resolved.password ||
    resolved.search ||
    resolved.hash
  ) {
    throw new VideoUploadError(
      "The upload returned an unsafe destination.",
      false,
      true,
    );
  }
  return resolved.toString();
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Video upload was stopped.", "AbortError");
}

async function currentSession(
  supabase: ReturnType<typeof createOurDaysBrowserClient>,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || !data.session.user.id) {
    throw new VideoUploadError(
      "Your private session needs to be renewed.",
      false,
    );
  }
  return {
    accessToken: data.session.access_token,
    accountId: data.session.user.id,
  };
}

function tusResponseStatus(error: Error | DetailedError) {
  if (!("originalResponse" in error) || !error.originalResponse) return null;
  return error.originalResponse.getStatus();
}

async function uploadWithTusClient(input: {
  endpoint: string;
  file: File;
  metadata: Readonly<Record<string, string>>;
  onStage: (stage: VideoUploadStage) => void;
  publishableKey: string;
  saveUploadUrl: (uploadUrl: string) => void;
  session: () => Promise<Readonly<{ accessToken: string }>>;
  signal: AbortSignal;
  uploadUrl?: string;
}) {
  const { Upload } = await import("tus-js-client");
  let sessionError: VideoUploadError | null = null;
  let upload: TusUpload;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      void upload.abort(false);
      finish(() => {
        try {
          throwIfAborted(input.signal);
        } catch (error) {
          reject(error);
        }
      });
    };

    upload = new Upload(input.file, {
      chunkSize: 6 * 1024 * 1024,
      endpoint: input.endpoint,
      headers: { apikey: input.publishableKey, "x-upsert": "false" },
      metadata: { ...input.metadata },
      onBeforeRequest: async (request: HttpRequest) => {
        try {
          const session = await input.session();
          request.setHeader("authorization", `Bearer ${session.accessToken}`);
        } catch (error) {
          sessionError =
            error instanceof VideoUploadError
              ? error
              : new VideoUploadError(
                  "Your private session needs to be renewed.",
                  false,
                );
          throw sessionError;
        }
      },
      onError: (error) => {
        finish(() => {
          if (sessionError) return reject(sessionError);
          const status = tusResponseStatus(error);
          if (status === 404 || status === 410 || status === 409) {
            reject(
              new VideoUploadError(
                "That interrupted video upload expired. Try again.",
                true,
                true,
              ),
            );
            return;
          }
          reject(
            new VideoUploadError(
              "The private video transfer could not be completed. Try again.",
            ),
          );
        });
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        input.onStage({
          state: "uploading",
          progress: bytesTotal === 0 ? 0 : bytesUploaded / bytesTotal,
        });
      },
      onSuccess: () => finish(resolve),
      onUploadUrlAvailable: () => {
        try {
          input.saveUploadUrl(resolvedUploadUrl(input.endpoint, upload.url));
        } catch (error) {
          void upload.abort(false);
          finish(() => reject(error));
        }
      },
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      storeFingerprintForResuming: false,
      uploadDataDuringCreation: true,
      uploadUrl: input.uploadUrl,
    });

    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) return abort();
    input.onStage({ state: "uploading", progress: 0 });
    upload.start();
  });
}

function firstRow<T>(value: readonly T[] | null) {
  return value?.[0];
}

async function uploadLocalVideoMoment(
  file: File,
  draft: VideoMomentDraft,
  attempt: VideoUploadAttempt,
  signal: AbortSignal,
  onStage: (stage: VideoUploadStage) => void,
) {
  throwIfAborted(signal);
  onStage({ state: "uploading", progress: 0.2 });
  const body = new FormData();
  body.set("file", file);
  body.set("journalPersonId", draft.journalPersonId);
  body.set("body", draft.body);
  body.set("placeName", draft.placeName);
  body.set("taggedPersonIds", JSON.stringify([...draft.taggedPersonIds]));
  body.set("occurredOn", draft.occurredOn);
  body.set("occurredAt", draft.occurredAt ?? "");
  body.set("occurredTimezone", draft.occurredTimezone ?? "");
  body.set("durationMs", String(draft.durationMs));
  body.set("requestKey", attempt.requestKey);
  const response = await fetch("/api/media/local/video", {
    body,
    credentials: "same-origin",
    method: "POST",
    signal,
  });
  throwIfAborted(signal);
  onStage({ state: "finishing" });
  let payload: { momentId?: string; message?: string } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }
  if (
    !response.ok ||
    typeof payload.momentId !== "string" ||
    !uuidPattern.test(payload.momentId)
  ) {
    throw new VideoUploadError(
      payload.message ?? "That video could not be uploaded.",
      response.status >= 500,
    );
  }
  attempt.momentId = payload.momentId;
  return { momentId: payload.momentId };
}

export async function uploadVideoMoment(
  file: File,
  draft: VideoMomentDraft,
  attempt: VideoUploadAttempt,
  signal: AbortSignal,
  onStage: (stage: VideoUploadStage) => void,
  dependencies: UploadDependencies = {},
) {
  throwIfAborted(signal);
  onStage({ state: "preparing" });
  const mimeType = inspectVideo(file, draft.durationMs);
  if (!readOptionalSupabasePublicConfig()) {
    return uploadLocalVideoMoment(file, draft, attempt, signal, onStage);
  }
  const createClient = dependencies.createClient ?? createOurDaysBrowserClient;
  const supabase = createClient();
  const { url, publishableKey } = readSupabasePublicConfig();
  const endpoint = resumableEndpoint(url);
  const session = await currentSession(supabase);
  throwIfAborted(signal);

  const { data: reservationRows, error: reservationError } = await supabase.rpc(
    "reserve_video_moment",
    {
      body: draft.body,
      circle_id: draft.circleId,
      duration_ms: draft.durationMs,
      expected_mime_type: mimeType,
      expected_size_bytes: file.size,
      journal_person_id: draft.journalPersonId,
      occurred_at: draft.occurredAt ?? undefined,
      occurred_on: draft.occurredOn,
      occurred_timezone: draft.occurredTimezone ?? undefined,
      place_name: draft.placeName,
      request_key: attempt.requestKey,
      tagged_person_ids: [...draft.taggedPersonIds],
    },
  );
  const reservation = firstRow(reservationRows);
  if (
    reservationError ||
    !reservation ||
    !uuidPattern.test(reservation.request_id) ||
    !uuidPattern.test(reservation.moment_id)
  ) {
    throw new VideoUploadError("That video moment could not be prepared.");
  }
  attempt.requestId = reservation.request_id;
  attempt.momentId = reservation.moment_id;
  if (reservation.state === "published") {
    return { momentId: reservation.moment_id };
  }

  const userMetadata = {
    video_request_id: reservation.request_id,
    request_key: attempt.requestKey,
    expected_mime_type: mimeType,
    expected_size_bytes: file.size,
    duration_ms: draft.durationMs,
  };
  await (dependencies.upload ?? uploadWithTusClient)({
    endpoint,
    file,
    metadata: {
      bucketName: reservation.bucket_id,
      objectName: reservation.object_path,
      contentType: mimeType,
      cacheControl: "3600",
      metadata: JSON.stringify(userMetadata),
    },
    onStage,
    publishableKey,
    saveUploadUrl: (uploadUrl) => {
      attempt.uploadUrl = uploadUrl;
    },
    session: async () => {
      const activeSession = await currentSession(supabase);
      if (activeSession.accountId !== session.accountId) {
        throw new VideoUploadError("Your family access changed.", false);
      }
      return { accessToken: activeSession.accessToken };
    },
    signal,
    uploadUrl: attempt.uploadUrl,
  });

  throwIfAborted(signal);
  onStage({ state: "finishing" });
  const { data: momentId, error: finalizeError } = await supabase.rpc(
    "finalize_video_moment",
    { request_id: reservation.request_id },
  );
  if (finalizeError || !momentId || momentId !== reservation.moment_id) {
    throw new VideoUploadError(
      "The upload finished, but the video could not yet be added. Try again.",
    );
  }
  return { momentId };
}
