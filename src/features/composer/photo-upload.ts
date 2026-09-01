import { resolveSupabaseOrigin } from "../../../config/supabase-origin";
import { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import { readSupabasePublicConfig } from "@/lib/supabase/public-config";
import { hashPhotoInWorker } from "./photo-hash";
import {
  photoUploadResumeStore,
  type PhotoUploadResumeRecord,
  type PhotoUploadResumeStore,
} from "./photo-upload-resume-store";

const maximumPhotoBytes = 25 * 1024 * 1024;
const tusChunkBytes = 6 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PhotoUploadStage =
  | Readonly<{ state: "preparing" }>
  | Readonly<{ state: "uploading"; progress: number }>
  | Readonly<{ state: "stopping" }>
  | Readonly<{ state: "finishing" }>
  | Readonly<{ state: "processing" }>;

export type PhotoUploadAttempt = {
  requestKey: string;
  uploadRequestKey: string;
  intakeId?: string;
  momentId?: string;
  uploadUrl?: string;
};

export type PhotoMomentDraft = Readonly<{
  circleId: string;
  journalPersonId: string;
  body: string;
  placeName: string;
  taggedPersonIds: readonly string[];
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
}>;

export type PhotoUploadResult = Readonly<{
  state: "published" | "processing";
  intakeId: string;
  momentId: string;
}>;

export class PhotoUploadError extends Error {
  readonly retryable: boolean;
  readonly discardResume: boolean;

  constructor(message: string, retryable = true, discardResume = false) {
    super(message);
    this.name = "PhotoUploadError";
    this.retryable = retryable;
    this.discardResume = discardResume;
  }
}

type UploadDependencies = Readonly<{
  createClient?: typeof createOurDaysBrowserClient;
  fetch?: typeof globalThis.fetch;
  hash?: typeof hashPhotoInWorker;
  pause?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  resumeStore?: PhotoUploadResumeStore;
  statusAttempts?: number;
}>;

export function createPhotoUploadAttempt(): PhotoUploadAttempt {
  return {
    requestKey: crypto.randomUUID(),
    uploadRequestKey: crypto.randomUUID(),
  };
}

function sameBytes(actual: Uint8Array, expected: readonly number[]) {
  return expected.every((byte, index) => actual[index] === byte);
}

export async function detectedPhotoMime(file: File) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (header.length >= 3 && sameBytes(header, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    header.length >= 8 &&
    sameBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (
    header.length >= 12 &&
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function normalizedDeclaredMime(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

async function inspectPhoto(file: File) {
  if (file.size < 1) {
    throw new PhotoUploadError(
      "That image is empty. Choose another one.",
      false,
    );
  }
  if (file.size > maximumPhotoBytes) {
    throw new PhotoUploadError("Choose an image smaller than 25 MB.", false);
  }
  const detectedMime = await detectedPhotoMime(file);
  if (!detectedMime) {
    throw new PhotoUploadError(
      "For now, choose a JPEG, PNG, or WebP photo.",
      false,
    );
  }
  const declaredMime = normalizedDeclaredMime(file.type);
  if (declaredMime && declaredMime !== detectedMime) {
    throw new PhotoUploadError(
      "That photo’s file type does not match its contents.",
      false,
    );
  }
  return detectedMime;
}

function asciiBase64(value: string) {
  return btoa(value);
}

function resumableEndpoint(supabaseUrl: string) {
  const origin = resolveSupabaseOrigin(supabaseUrl);
  return `${origin.storageHttp ?? origin.http}/storage/v1/upload/resumable`;
}

function resolvedUploadUrl(endpoint: string, location: string | null) {
  if (!location) throw new PhotoUploadError("The upload could not be started.");
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
    throw new PhotoUploadError(
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
  throw new DOMException("Photo upload was stopped.", "AbortError");
}

async function currentSession(
  supabase: ReturnType<typeof createOurDaysBrowserClient>,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || !data.session.user.id) {
    throw new PhotoUploadError(
      "Your private session needs to be renewed.",
      false,
    );
  }
  return {
    accessToken: data.session.access_token,
    accountId: data.session.user.id,
  };
}

function authenticatedTusHeaders(publishableKey: string, token: string) {
  return {
    apikey: publishableKey,
    authorization: `Bearer ${token}`,
    "tus-resumable": "1.0.0",
    "x-upsert": "false",
  };
}

async function remoteOffset(
  fetcher: typeof globalThis.fetch,
  uploadUrl: string,
  headers: () => Promise<Readonly<Record<string, string>>>,
  signal: AbortSignal,
) {
  const response = await fetcher(uploadUrl, {
    headers: await headers(),
    method: "HEAD",
    signal,
  });
  if (response.status === 404 || response.status === 410) {
    throw new PhotoUploadError(
      "That interrupted upload expired. Try the upload again.",
      true,
      true,
    );
  }
  if (response.status === 409) {
    throw new PhotoUploadError(
      "That interrupted upload changed. Try the upload again.",
      true,
      true,
    );
  }
  const value = response.headers.get("upload-offset");
  const offset = value === null ? Number.NaN : Number(value);
  if (!response.ok || !Number.isSafeInteger(offset) || offset < 0) {
    throw new PhotoUploadError("The interrupted upload could not be resumed.");
  }
  return offset;
}

async function uploadChunks(input: {
  file: File;
  fetcher: typeof globalThis.fetch;
  headers: () => Promise<Readonly<Record<string, string>>>;
  onStage: (stage: PhotoUploadStage) => void;
  pause: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  uploadUrl: string;
}) {
  let offset = await remoteOffset(
    input.fetcher,
    input.uploadUrl,
    input.headers,
    input.signal,
  );
  if (offset > input.file.size) {
    throw new PhotoUploadError("The upload position was invalid.", false);
  }
  input.onStage({
    state: "uploading",
    progress: input.file.size === 0 ? 0 : offset / input.file.size,
  });

  while (offset < input.file.size) {
    const end = Math.min(offset + tusChunkBytes, input.file.size);
    let transientFailures = 0;
    let response: Response | null = null;
    while (true) {
      try {
        response = await input.fetcher(input.uploadUrl, {
          body: input.file.slice(offset, end),
          headers: {
            ...(await input.headers()),
            "content-type": "application/offset+octet-stream",
            "upload-offset": String(offset),
          },
          method: "PATCH",
          signal: input.signal,
        });
        break;
      } catch (error) {
        if (input.signal.aborted) throw error;
        transientFailures += 1;
        if (transientFailures > 4) {
          throw new PhotoUploadError(
            "The photo upload kept losing its connection.",
          );
        }
        await input.pause(
          Math.min(2_000, 250 * 2 ** (transientFailures - 1)) +
            Math.floor(Math.random() * 101),
          input.signal,
        );
        const recoveredOffset = await remoteOffset(
          input.fetcher,
          input.uploadUrl,
          input.headers,
          input.signal,
        );
        if (recoveredOffset > input.file.size) {
          throw new PhotoUploadError("The upload position was invalid.", false);
        }
        if (recoveredOffset !== offset) {
          offset = recoveredOffset;
          break;
        }
      }
    }
    if (!response) {
      input.onStage({ state: "uploading", progress: offset / input.file.size });
      continue;
    }
    const nextOffset = Number(response.headers.get("upload-offset"));
    if (response.status === 404 || response.status === 410) {
      throw new PhotoUploadError(
        "That interrupted upload expired. Try the upload again.",
        true,
        true,
      );
    }
    if (response.status === 409) {
      throw new PhotoUploadError(
        "That interrupted upload changed. Try the upload again.",
        true,
        true,
      );
    }
    if (
      !response.ok ||
      !Number.isSafeInteger(nextOffset) ||
      nextOffset <= offset ||
      nextOffset > input.file.size
    ) {
      throw new PhotoUploadError("The photo upload was interrupted.");
    }
    offset = nextOffset;
    input.onStage({ state: "uploading", progress: offset / input.file.size });
  }
}

function defaultPause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(
          new DOMException("Photo processing was cancelled.", "AbortError"),
        );
      },
      { once: true },
    );
  });
}

function firstRow<T>(value: readonly T[] | null) {
  return value?.[0];
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function draftFingerprint(draft: PhotoMomentDraft) {
  const normalized = JSON.stringify({
    body: draft.body.trim(),
    circleId: draft.circleId,
    journalPersonId: draft.journalPersonId,
    occurredAt: draft.occurredAt,
    occurredOn: draft.occurredOn,
    occurredTimezone: draft.occurredTimezone,
    placeName: draft.placeName.trim(),
    taggedPersonIds: [...draft.taggedPersonIds].sort(),
  });
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)),
  );
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function photoQuotaMessage(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (
    message.includes("PHOTO_ACCOUNT_OPEN_QUOTA") ||
    message.includes("PHOTO_CIRCLE_OPEN_QUOTA")
  ) {
    return "You have too many unfinished private uploads to start another. Review unfinished photos and remove one first.";
  }
  if (
    message.includes("PHOTO_ACCOUNT_BYTE_QUOTA") ||
    message.includes("PHOTO_CIRCLE_BYTE_QUOTA")
  ) {
    return "Private removal is still finishing for earlier uploads. Review unfinished photos before trying again.";
  }
  return null;
}

function renewPhotoUploadAttempt(attempt: PhotoUploadAttempt) {
  const renewed = createPhotoUploadAttempt();
  attempt.requestKey = renewed.requestKey;
  attempt.uploadRequestKey = renewed.uploadRequestKey;
  delete attempt.intakeId;
  delete attempt.momentId;
  delete attempt.uploadUrl;
}

export async function uploadPhotoMoment(
  file: File,
  draft: PhotoMomentDraft,
  attempt: PhotoUploadAttempt,
  signal: AbortSignal,
  onStage: (stage: PhotoUploadStage) => void,
  dependencies: UploadDependencies = {},
): Promise<PhotoUploadResult> {
  throwIfAborted(signal);
  onStage({ state: "preparing" });
  const mimeType = await inspectPhoto(file);
  throwIfAborted(signal);
  const hash = dependencies.hash ?? hashPhotoInWorker;
  const sha256 = await hash(file, signal);
  throwIfAborted(signal);
  const createClient = dependencies.createClient ?? createOurDaysBrowserClient;
  const supabase = createClient();
  const { url, publishableKey } = readSupabasePublicConfig();
  const endpoint = resumableEndpoint(url);
  const session = await currentSession(supabase);
  throwIfAborted(signal);
  const resumeStore = dependencies.resumeStore ?? photoUploadResumeStore;
  const draftHash = await draftFingerprint(draft);
  throwIfAborted(signal);
  const resumed = await resumeStore.find({
    accountId: session.accountId,
    circleId: draft.circleId,
    draftHash,
    fileSha256: sha256,
    fileSize: file.size,
    mimeType,
  });
  const resumeId = resumed?.id ?? crypto.randomUUID();
  let acknowledgementStarted = false;

  const retireAttempt = async () => {
    if (attempt.intakeId) {
      const { data, error } = await supabase.rpc("cancel_photo_intake", {
        intake_id: attempt.intakeId,
      });
      const cancellation = firstRow(data);
      if (error || cancellation?.state !== "invalidated") return false;
    }
    await resumeStore.remove(resumeId);
    renewPhotoUploadAttempt(attempt);
    return true;
  };

  try {
    if (resumed) {
      attempt.requestKey = resumed.requestKey;
      attempt.uploadRequestKey = resumed.uploadRequestKey;
      attempt.intakeId = resumed.intakeId;
      attempt.momentId = resumed.momentId;
      attempt.uploadUrl = resumed.uploadUrl
        ? resolvedUploadUrl(endpoint, resumed.uploadUrl)
        : undefined;
    }
    throwIfAborted(signal);

    const saveResume = async (
      changes: Partial<PhotoUploadResumeRecord> = {},
    ) => {
      await resumeStore.save({
        id: resumeId,
        accountId: session.accountId,
        circleId: draft.circleId,
        draftHash,
        fileSha256: sha256,
        fileSize: file.size,
        mimeType,
        requestKey: attempt.requestKey,
        uploadRequestKey: attempt.uploadRequestKey,
        intakeId: attempt.intakeId,
        momentId: attempt.momentId,
        uploadUrl: attempt.uploadUrl,
        expiresAt: resumed?.expiresAt,
        acknowledged: resumed?.acknowledged ?? false,
        ...changes,
      });
    };

    const { data: reservationRows, error: reservationError } =
      await supabase.rpc("reserve_photo_moment", {
        body: draft.body,
        circle_id: draft.circleId,
        journal_person_id: draft.journalPersonId,
        occurred_at: draft.occurredAt ?? undefined,
        occurred_on: draft.occurredOn,
        occurred_timezone: draft.occurredTimezone ?? undefined,
        place_name: draft.placeName,
        request_key: attempt.requestKey,
        tagged_person_ids: [...draft.taggedPersonIds],
      });
    const reservationQuotaMessage = photoQuotaMessage(reservationError);
    if (reservationQuotaMessage) {
      throw new PhotoUploadError(reservationQuotaMessage);
    }
    const reservation = firstRow(reservationRows);
    if (
      reservationError ||
      !reservation ||
      !uuidPattern.test(reservation.intake_id) ||
      !uuidPattern.test(reservation.moment_id)
    ) {
      throw new PhotoUploadError("That photo moment could not be prepared.");
    }
    attempt.intakeId = reservation.intake_id;
    attempt.momentId = reservation.moment_id;
    await saveResume({ expiresAt: reservation.expires_at });
    throwIfAborted(signal);

    const { data: claimRows, error: claimError } = await supabase.rpc(
      "claim_photo_intake_upload",
      {
        expected_mime_type: mimeType,
        expected_sha256_hex: sha256,
        expected_size_bytes: file.size,
        intake_id: reservation.intake_id,
        upload_request_key: attempt.uploadRequestKey,
      },
    );
    const claimQuotaMessage = photoQuotaMessage(claimError);
    if (claimQuotaMessage) {
      throw new PhotoUploadError(claimQuotaMessage, true, true);
    }
    throwIfAborted(signal);
    const claim = firstRow(claimRows);
    if (claimError || !claim) {
      throw new PhotoUploadError("That private upload could not be prepared.");
    }

    const fetcher = dependencies.fetch ?? globalThis.fetch;
    const headers = async () => {
      const activeSession = await currentSession(supabase);
      if (activeSession.accountId !== session.accountId) {
        throw new PhotoUploadError("Your family access changed.", false);
      }
      return authenticatedTusHeaders(publishableKey, activeSession.accessToken);
    };
    await saveResume({ expiresAt: claim.upload_expires_at });
    throwIfAborted(signal);
    if (claim.state !== "uploaded_unverified") {
      if (!attempt.uploadUrl) {
        const metadata = {
          expected_mime_type: mimeType,
          expected_sha256: sha256,
          expected_size_bytes: file.size,
          intake_id: reservation.intake_id,
          upload_request_key: attempt.uploadRequestKey,
        };
        const response = await fetcher(endpoint, {
          headers: {
            ...(await headers()),
            "upload-length": String(file.size),
            "upload-metadata": [
              `bucketName ${asciiBase64(claim.bucket_id)}`,
              `objectName ${asciiBase64(claim.object_path)}`,
              `contentType ${asciiBase64(mimeType)}`,
              `cacheControl ${asciiBase64("3600")}`,
              `metadata ${asciiBase64(JSON.stringify(metadata))}`,
            ].join(","),
          },
          method: "POST",
          signal,
        });
        throwIfAborted(signal);
        if (!response.ok) {
          throw new PhotoUploadError(
            "The private upload could not be started.",
          );
        }
        attempt.uploadUrl = resolvedUploadUrl(
          endpoint,
          response.headers.get("location"),
        );
        await saveResume({
          expiresAt: claim.upload_expires_at,
          uploadUrl: attempt.uploadUrl,
        });
        throwIfAborted(signal);
      }
      const pause = dependencies.pause ?? defaultPause;
      await uploadChunks({
        file,
        fetcher,
        headers,
        onStage,
        pause,
        signal,
        uploadUrl: attempt.uploadUrl,
      });
    }

    throwIfAborted(signal);
    acknowledgementStarted = true;
    onStage({ state: "finishing" });
    const { error: acknowledgementError } = await supabase.rpc(
      "acknowledge_photo_intake",
      { intake_id: reservation.intake_id },
    );
    if (acknowledgementError) {
      throw new PhotoUploadError(
        "The upload finished, but could not yet be confirmed.",
      );
    }
    await saveResume({
      acknowledged: true,
      expiresAt: claim.upload_expires_at,
    });

    onStage({ state: "processing" });
    const pause = dependencies.pause ?? defaultPause;
    const statusAttempts = dependencies.statusAttempts ?? 1;
    for (let index = 0; index < statusAttempts; index += 1) {
      const { data: statusRows, error: statusError } = await supabase.rpc(
        "get_photo_moment_status",
        { intake_id: reservation.intake_id },
      );
      const status = firstRow(statusRows);
      if (statusError || !status) {
        throw new PhotoUploadError(
          "The photo’s private status was unavailable.",
        );
      }
      if (status.status === "published") {
        await resumeStore.remove(resumeId);
        return {
          state: "published",
          intakeId: reservation.intake_id,
          momentId: reservation.moment_id,
        };
      }
      if (status.status === "needs_attention") {
        throw new PhotoUploadError(
          "This photo needs attention before it can be added.",
          false,
        );
      }
      if (status.status === "cancelled") {
        await resumeStore.remove(resumeId);
        renewPhotoUploadAttempt(attempt);
        throw new PhotoUploadError(
          "This unfinished photo was cancelled and will not be added.",
          true,
        );
      }
      if (index + 1 < statusAttempts) await pause(1500, signal);
    }
    return {
      state: "processing",
      intakeId: reservation.intake_id,
      momentId: reservation.moment_id,
    };
  } catch (error) {
    const abort = isAbortError(error);
    const discardResume =
      error instanceof PhotoUploadError && error.discardResume;
    if ((abort && !acknowledgementStarted) || discardResume) {
      const retired = await retireAttempt();
      if (!retired) {
        throw new PhotoUploadError(
          "The transfer stopped on this device, but cancellation could not be confirmed. Review unfinished photos before trying again.",
          false,
        );
      }
      if (abort) {
        throw new PhotoUploadError(
          "Upload stopped. This photo won’t be added. Private removal is finishing.",
          true,
        );
      }
    }
    if (abort && acknowledgementStarted) {
      throw new PhotoUploadError(
        "The photo was already finishing privately. Check its status before trying again.",
        false,
      );
    }
    throw error;
  }
}
