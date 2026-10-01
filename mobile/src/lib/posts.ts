import type { SupabaseClient } from "@supabase/supabase-js";

import { sessionCookieHeader } from "./auth-cookie";
import {
  authStorageKey,
  siteOrigin,
  supabasePublishableKey,
  supabaseUrl,
} from "./config";
import { sha256Hex } from "./sha256";
import { persistVideoPoster, type VideoPoster } from "./video-poster-store";

export type Audience = "family" | "just_me";

export type PostResult =
  | Readonly<{ ok: true; momentId: string }>
  | Readonly<{ ok: false; message: string }>;

export type UploadChip = Readonly<{
  id: string;
  label: string;
  detail: string;
  /** 0–1 while bytes are moving. Null hides the bar. */
  progress: number | null;
  failed: boolean;
  done: boolean;
}>;

export type DraftListItem = Readonly<{
  id: string;
  kind: string;
  previewText: string;
  session: boolean;
}>;

export type DraftRecord = Readonly<{
  id: string;
  kind: string;
  title: string;
  body: string;
  sourceUrl: string;
  audience: Audience;
  circleId: string | null;
  occurredOn: string | null;
  verse: {
    book: string | null;
    chapter: number | null;
    startVerse: number | null;
    endVerse: number | null;
  };
  session: boolean;
}>;

type InsightSessionDraft = {
  id: string;
  body: string;
  title: string;
  sourceUrl: string;
  audience: Audience;
  circleId: string | null;
  occurredOn: string;
};

const chips: UploadChip[] = [];
const listeners = new Set<() => void>();
const insightDrafts: InsightSessionDraft[] = [];
const retryInputs = new Map<string, PhotoUploadInput | VideoUploadInput>();
const maximumPhotoBytes = 25 * 1024 * 1024;
const tusChunkBytes = 6 * 1024 * 1024;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeUploads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listUploads() {
  return chips.slice();
}

export function dismissUpload(id: string) {
  const index = chips.findIndex((chip) => chip.id === id);
  if (index >= 0) chips.splice(index, 1);
  retryInputs.delete(id);
  emit();
}

/** Tell the feed a post landed, then drop the chip so no confirmation card stays up. */
function publishChip(id: string) {
  const current = chips.find((chip) => chip.id === id);
  if (current && !current.done) {
    putChip({ ...current, progress: null, failed: false, done: true });
  }
  dismissUpload(id);
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function firstRow<T>(data: T | readonly T[] | null) {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data;
}

const friendlyCodes: Readonly<Record<string, string>> = {
  PHOTO_ACCOUNT_OPEN_QUOTA:
    "A few of your photos are still finishing. Try again in a few minutes.",
  PHOTO_CIRCLE_OPEN_QUOTA:
    "This circle has several photos still finishing. Try again in a few minutes.",
};

function message(error: { message?: string } | null, fallback: string) {
  const text = error?.message;
  if (!text) return fallback;
  const code = Object.keys(friendlyCodes).find((key) => text.includes(key));
  if (code) return friendlyCodes[code] ?? fallback;
  return text.length < 180 ? text : fallback;
}

function putChip(next: UploadChip) {
  const index = chips.findIndex((chip) => chip.id === next.id);
  if (index >= 0) chips[index] = next;
  else chips.unshift(next);
  emit();
}

export async function createWrittenMoment(
  supabase: SupabaseClient,
  input: Readonly<{
    journalPersonId: string;
    circleId: string;
    body: string;
    occurredOn: string;
    occurredAt?: string | null;
    occurredTimezone?: string | null;
    audience: Audience;
    circleIds?: readonly string[];
  }>,
): Promise<PostResult> {
  const { data, error } = await supabase.rpc("create_written_moment", {
    circle_id: input.circleId,
    journal_person_id: input.journalPersonId,
    body: input.body.trim(),
    occurred_on: input.occurredOn,
    occurred_at: input.occurredAt ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
    audience: input.audience,
    ...(input.audience === "family" && input.circleIds?.length
      ? { circle_ids: [...input.circleIds] }
      : {}),
  });
  if (error || typeof data !== "string") {
    return {
      ok: false,
      message: message(error, "That moment could not be saved. Your draft is still here."),
    };
  }
  return { ok: true, momentId: data };
}

/** Connected notes, verses, and places. Same RPC the web composer calls. */
export async function createFamilyMoment(
  supabase: SupabaseClient,
  input: Readonly<{
    journalPersonId: string;
    circleId: string;
    body: string;
    placeName?: string;
    latitude?: number | null;
    longitude?: number | null;
    taggedPersonIds?: readonly string[];
    occurredOn: string;
    occurredAt?: string | null;
    occurredTimezone?: string | null;
    audience: Audience;
    circleIds?: readonly string[];
  }>,
): Promise<PostResult> {
  const { data, error } = await supabase.rpc("create_family_moment", {
    circle_id: input.circleId,
    journal_person_id: input.journalPersonId,
    moment_kind: "thought",
    moment_title: "",
    moment_body: input.body.trim(),
    place_name: input.placeName?.trim() ?? "",
    tagged_person_ids: [...(input.taggedPersonIds ?? [])],
    occurred_on: input.occurredOn,
    occurred_at: input.occurredAt ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
    audience: input.audience,
    ...(input.latitude != null && input.longitude != null
      ? { latitude: input.latitude, longitude: input.longitude }
      : {}),
    ...(input.audience === "family" && input.circleIds?.length
      ? { circle_ids: [...input.circleIds] }
      : {}),
  });
  if (error || typeof data !== "string") {
    return {
      ok: false,
      message: message(error, "That moment could not be saved. Your draft is still here."),
    };
  }
  return { ok: true, momentId: data };
}

export async function createInsightMoment(
  supabase: SupabaseClient,
  input: Readonly<{
    circleId: string;
    quote: string;
    attribution: string;
    sourceUrl?: string;
    occurredOn: string;
    occurredAt?: string | null;
    occurredTimezone?: string | null;
    audience: Audience;
    circleIds?: readonly string[];
  }>,
): Promise<PostResult> {
  const { data, error } = await supabase.rpc("create_insight_moment", {
    circle_id: input.circleId,
    quote: input.quote.trim(),
    attribution: input.attribution.trim(),
    source_url: input.sourceUrl?.trim() || undefined,
    occurred_on: input.occurredOn,
    occurred_at: input.occurredAt ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
    audience: input.audience,
    circle_ids: input.audience === "family" ? [...(input.circleIds ?? [])] : [],
  });
  if (error || typeof data !== "string") {
    const denied = error?.code === "42501";
    return {
      ok: false,
      message: denied
        ? "Only an organizer or Operations can create an Insight."
        : message(error, "Insight could not be created."),
    };
  }
  return { ok: true, momentId: data };
}

export async function updateWrittenMoment(
  supabase: SupabaseClient,
  input: Readonly<{
    momentId: string;
    revision: number;
    body: string;
    occurredOn: string;
    occurredAt?: string | null;
    occurredTimezone?: string | null;
  }>,
): Promise<PostResult & { revision?: number }> {
  const { data, error } = await supabase.rpc("update_written_moment", {
    moment_id: input.momentId,
    expected_revision: input.revision,
    body: input.body.trim(),
    occurred_on: input.occurredOn,
    occurred_at: input.occurredAt ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
  });
  if (error) {
    return { ok: false, message: message(error, "That moment could not be changed.") };
  }
  return { ok: true, momentId: input.momentId, revision: typeof data === "number" ? data : input.revision };
}

export async function trashWrittenMoment(
  supabase: SupabaseClient,
  momentId: string,
  revision = 1,
): Promise<PostResult> {
  const { error } = await supabase.rpc("set_written_moment_trashed", {
    moment_id: momentId,
    expected_revision: revision,
    trashed: true,
  });
  if (error) {
    return { ok: false, message: message(error, "That moment could not be changed.") };
  }
  return { ok: true, momentId };
}

const emptyVerse = {
  book: null,
  chapter: null,
  startVerse: null,
  endVerse: null,
};

export async function listEntryDrafts(
  supabase: SupabaseClient,
): Promise<DraftListItem[]> {
  const { data, error } = await supabase.rpc("list_entry_drafts");
  const server: DraftListItem[] =
    error || !Array.isArray(data)
      ? []
      : data.flatMap((row) => {
          const item = row as {
            draft_id?: string;
            kind?: string;
            preview_text?: string;
          };
          if (!item.draft_id || !item.kind) return [];
          return [
            {
              id: item.draft_id,
              kind: item.kind,
              previewText: item.preview_text ?? "",
              session: false,
            },
          ];
        });
  const session = insightDrafts.map((draft) => ({
    id: draft.id,
    kind: "insight",
    previewText: draft.title || draft.body.slice(0, 80),
    session: true,
  }));
  return [...session, ...server];
}

export async function loadEntryDraft(
  supabase: SupabaseClient,
  id: string,
): Promise<DraftRecord | null> {
  const session = insightDrafts.find((draft) => draft.id === id);
  if (session) {
    return {
      id: session.id,
      kind: "insight",
      title: session.title,
      body: session.body,
      sourceUrl: session.sourceUrl,
      audience: session.audience,
      circleId: session.circleId,
      occurredOn: session.occurredOn,
      verse: emptyVerse,
      session: true,
    };
  }
  const { data, error } = await supabase.rpc("get_entry_draft", { draft_id: id });
  const row = firstRow(data) as
    | {
        draft_id?: string;
        kind?: string;
        title?: string;
        body?: string;
        audience?: string;
        circle_ids?: string[] | null;
        occurred_on?: string | null;
        verse?: {
          book?: string | null;
          chapter?: number | null;
          startVerse?: number | null;
          endVerse?: number | null;
        } | null;
      }
    | null;
  if (error || !row?.draft_id || !row.kind) return null;
  return {
    id: row.draft_id,
    kind: row.kind,
    title: row.title ?? "",
    body: row.body ?? "",
    sourceUrl: "",
    audience: row.audience === "just_me" ? "just_me" : "family",
    circleId: row.circle_ids?.[0] ?? null,
    occurredOn: row.occurred_on ?? null,
    verse: {
      book: row.verse?.book ?? null,
      chapter: row.verse?.chapter ?? null,
      startVerse: row.verse?.startVerse ?? null,
      endVerse: row.verse?.endVerse ?? null,
    },
    session: false,
  };
}

export async function saveEntryDraft(
  supabase: SupabaseClient,
  input: Readonly<{
    id?: string;
    kind: "thought" | "photo" | "bible-verse" | "insight";
    title: string;
    body: string;
    sourceUrl?: string;
    audience: Audience;
    circleIds: readonly string[];
    journalPersonId: string | null;
    occurredOn: string;
    occurredTime?: string;
    occurredTimezone: string;
    placeName?: string;
    latitude?: number | null;
    longitude?: number | null;
    taggedPersonIds?: readonly string[];
    verse: DraftRecord["verse"];
  }>,
): Promise<PostResult> {
  if (input.kind === "insight") {
    const id = input.id ?? randomId();
    const next: InsightSessionDraft = {
      id,
      body: input.body,
      title: input.title,
      sourceUrl: input.sourceUrl ?? "",
      audience: input.audience,
      circleId: input.circleIds[0] ?? null,
      occurredOn: input.occurredOn,
    };
    const index = insightDrafts.findIndex((draft) => draft.id === id);
    if (index >= 0) insightDrafts[index] = next;
    else insightDrafts.unshift(next);
    return { ok: true, momentId: id };
  }
  const { data, error } = await supabase.rpc("save_entry_draft", {
    draft_id: input.id,
    kind: input.kind,
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 4000),
    audience: input.audience,
    circle_ids: [...input.circleIds],
    journal_person_id: input.journalPersonId ?? undefined,
    tagged_person_ids: [...(input.taggedPersonIds ?? [])],
    place_name: (input.placeName ?? "").slice(0, 200),
    latitude: input.latitude ?? undefined,
    longitude: input.longitude ?? undefined,
    occurred_on: input.occurredOn,
    occurred_time: input.occurredTime || undefined,
    occurred_timezone: input.occurredTimezone,
    media: [],
    verse: input.verse,
  });
  if (error || typeof data !== "string") {
    const text = error?.message ?? "";
    return {
      ok: false,
      message: text.includes("Delete a draft first")
        ? "Delete a draft first. You can keep up to 20."
        : "That draft could not be saved.",
    };
  }
  return { ok: true, momentId: data };
}

export async function deleteEntryDraft(
  supabase: SupabaseClient,
  id: string,
  session: boolean,
): Promise<PostResult> {
  if (session) {
    const index = insightDrafts.findIndex((draft) => draft.id === id);
    if (index >= 0) insightDrafts.splice(index, 1);
    return { ok: true, momentId: id };
  }
  const { error } = await supabase.rpc("delete_entry_draft", { draft_id: id });
  if (error) return { ok: false, message: "That draft could not be deleted." };
  return { ok: true, momentId: id };
}

export type PhotoUploadInput = Readonly<{
  bytes: ArrayBuffer;
  mimeType: string;
  circleId: string;
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt?: string | null;
  occurredTimezone?: string | null;
  placeName?: string;
  taggedPersonIds?: readonly string[];
  audience: Audience;
  circleIds?: readonly string[];
}>;

function dateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function detectedMime(bytes: ArrayBuffer) {
  const header = new Uint8Array(bytes.slice(0, 12));
  const same = (expected: readonly number[]) =>
    expected.every((byte, index) => header[index] === byte);
  if (header.length >= 3 && same([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (header.length >= 8 && same([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
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

function inspectPhoto(bytes: ArrayBuffer, declared: string) {
  if (bytes.byteLength < 1) {
    throw new Error("That image is empty. Choose another one.");
  }
  if (bytes.byteLength > maximumPhotoBytes) {
    throw new Error("Choose an image smaller than 25 MB.");
  }
  const mime = detectedMime(bytes);
  if (!mime) {
    throw new Error("For now, choose a JPEG, PNG, or WebP photo.");
  }
  const normalized = declared.trim().toLowerCase() === "image/jpg" ? "image/jpeg" : declared.trim().toLowerCase();
  if (normalized && normalized !== mime) {
    throw new Error("That photo’s file type does not match its contents.");
  }
  return mime;
}

function asciiBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let output = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = index + 1 < bytes.length ? (bytes[index + 1] ?? 0) : 0;
    const third = index + 2 < bytes.length ? (bytes[index + 2] ?? 0) : 0;
    const triple = (first << 16) | (second << 8) | third;
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return output;
}

function resumableEndpoint() {
  return `${supabaseUrl.replace(/\/$/u, "")}/storage/v1/upload/resumable`;
}

function resolvedUploadUrl(endpoint: string, location: string | null) {
  if (!location) throw new Error("The upload could not be started.");
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
    throw new Error("The upload returned an unsafe destination.");
  }
  return resolved.toString();
}

async function authHeaders() {
  const { getSupabase } = await import("./supabase");
  const supabase = getSupabase();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error("Your private session needs to be renewed.");
  return {
    apikey: supabasePublishableKey,
    authorization: `Bearer ${session.access_token}`,
    "tus-resumable": "1.0.0",
    "x-upsert": "false",
  };
}

function xhrRequest(input: {
  method: "POST" | "PATCH" | "HEAD";
  url: string;
  headers: Record<string, string>;
  body?: ArrayBuffer;
  onProgress?: (loaded: number, total: number) => void;
}) {
  return new Promise<{ status: number; location: string | null; offset: string | null }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(input.method, input.url);
      for (const [key, value] of Object.entries(input.headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
      };
      xhr.onload = () => {
        resolve({
          status: xhr.status,
          location: xhr.getResponseHeader("location"),
          offset: xhr.getResponseHeader("upload-offset"),
        });
      };
      xhr.onerror = () => reject(new Error("The photo upload kept losing its connection."));
      xhr.send(input.body ?? null);
    },
  );
}

async function uploadWithTus(
  bucket: string,
  objectPath: string,
  bytes: ArrayBuffer,
  mimeType: string,
  metadata: Readonly<Record<string, string | number>>,
  onProgress: (fraction: number) => void,
) {
  const endpoint = resumableEndpoint();
  const headers = await authHeaders();
  const encoded = Object.entries({
    bucketName: bucket,
    objectName: objectPath,
    contentType: mimeType,
    cacheControl: "3600",
    metadata: JSON.stringify(metadata),
  })
    .map(([key, value]) => `${key} ${asciiBase64(value)}`)
    .join(",");
  const created = await xhrRequest({
    method: "POST",
    url: endpoint,
    headers: {
      ...headers,
      "upload-length": String(bytes.byteLength),
      "upload-metadata": encoded,
    },
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error("The private upload could not be started.");
  }
  const uploadUrl = resolvedUploadUrl(endpoint, created.location);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(offset + tusChunkBytes, bytes.byteLength);
    const chunk = bytes.slice(offset, end);
    const response = await xhrRequest({
      method: "PATCH",
      url: uploadUrl,
      headers: {
        ...(await authHeaders()),
        "content-type": "application/offset+octet-stream",
        "upload-offset": String(offset),
      },
      body: chunk,
      onProgress: (loaded, total) => {
        if (total > 0) onProgress((offset + loaded) / bytes.byteLength);
      },
    });
    const next = Number(response.offset);
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !Number.isSafeInteger(next) ||
      next <= offset
    ) {
      throw new Error("The photo upload was interrupted.");
    }
    offset = next;
    onProgress(offset / bytes.byteLength);
  }
}

function runsInBrowser() {
  return (
    typeof document !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.product !== "ReactNative"
  );
}

async function requestPhotoProcessing(intakeId: string) {
  const { getSupabase } = await import("./supabase");
  const supabase = getSupabase();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) {
    throw new Error("Your private session needs to be renewed.");
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${session.access_token}`,
  };
  // React Native can set Origin and Cookie. A browser forbids both and sends
  // its own Origin, so Expo web matches the web app: no manual cookie or origin.
  if (!runsInBrowser()) {
    headers.cookie = sessionCookieHeader(authStorageKey(), session);
    headers.origin = siteOrigin;
  }
  const response = await fetch(`${siteOrigin}/api/photos/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({ intakeId }),
  });
  if (!response.ok) {
    let text = "Upload failed";
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) text = body.message;
    } catch {
      // A 404 from the origin check has no message.
    }
    throw new Error(text);
  }
  return response.status;
}

async function finishPhoto(supabase: SupabaseClient, intakeId: string, chipId: string, detail: string) {
  const update = (patch: Partial<UploadChip>) => {
    const current = chips.find((chip) => chip.id === chipId);
    if (!current) return;
    putChip({ ...current, ...patch });
  };
  try {
    await requestPhotoProcessing(intakeId);
  } catch (error) {
    update({
      label: "Upload failed",
      detail: error instanceof Error ? error.message : "Upload failed",
      progress: null,
      failed: true,
      done: false,
    });
    return;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data } = await supabase.rpc("get_photo_moment_status", { intake_id: intakeId });
    const status = firstRow(data) as { status?: string } | null;
    if (status?.status === "published") {
      publishChip(chipId);
      return;
    }
    if (status?.status === "needs_attention" || status?.status === "cancelled") {
      update({
        label: "Upload failed",
        detail: "This photo needs attention before it can be added.",
        progress: null,
        failed: true,
        done: false,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  update({
    label: "Uploading…",
    detail,
    progress: null,
    failed: false,
    done: false,
  });
}

/**
 * Same reserve → claim → resumable storage upload → acknowledge path as
 * `src/features/composer/photo-upload.ts`, then the existing `/api/photos/process` worker.
 */
export async function uploadPhotoMoment(supabase: SupabaseClient, input: PhotoUploadInput) {
  const id = randomId();
  const detail = dateLabel(input.occurredOn);
  retryInputs.set(id, input);
  const update = (patch: Partial<UploadChip> & { label: string }) =>
    putChip({
      id,
      detail,
      progress: null,
      failed: false,
      done: false,
      ...patch,
    });
  update({ label: "Uploading…", progress: 0 });
  try {
    const mimeType = inspectPhoto(input.bytes, input.mimeType);
    const sha256 = sha256Hex(input.bytes);
    const requestKey = randomId();
    const uploadKey = randomId();
    const { data: reserved, error: reserveError } = await supabase.rpc("reserve_photo_moment", {
      body: input.body,
      circle_id: input.circleId,
      journal_person_id: input.journalPersonId,
      occurred_on: input.occurredOn,
      occurred_at: input.occurredAt ?? undefined,
      occurred_timezone: input.occurredTimezone ?? undefined,
      place_name: input.placeName?.trim() ?? "",
      request_key: requestKey,
      tagged_person_ids: [...(input.taggedPersonIds ?? [])],
      audience: input.audience,
      ...(input.audience === "family" && input.circleIds?.length
        ? { circle_ids: [...input.circleIds] }
        : {}),
    });
    const reservation = firstRow(reserved) as { intake_id?: string; moment_id?: string } | null;
    if (reserveError || !reservation?.intake_id || !reservation.moment_id) {
      throw new Error(message(reserveError, "That photo moment could not be prepared."));
    }
    const { data: claimed, error: claimError } = await supabase.rpc("claim_photo_intake_upload", {
      expected_mime_type: mimeType,
      expected_sha256_hex: sha256,
      expected_size_bytes: input.bytes.byteLength,
      intake_id: reservation.intake_id,
      upload_request_key: uploadKey,
    });
    const claim = firstRow(claimed) as
      | { bucket_id?: string; object_path?: string; state?: string }
      | null;
    if (claimError || !claim?.bucket_id || !claim.object_path) {
      throw new Error(message(claimError, "That private upload could not be prepared."));
    }
    if (claim.state !== "uploaded_unverified") {
      await uploadWithTus(
        claim.bucket_id,
        claim.object_path,
        input.bytes,
        mimeType,
        {
          expected_mime_type: mimeType,
          expected_sha256: sha256,
          expected_size_bytes: input.bytes.byteLength,
          intake_id: reservation.intake_id,
          upload_request_key: uploadKey,
        },
        (fraction) => update({ label: percentLabel(fraction), progress: fraction }),
      );
    }
    const { error: ackError } = await supabase.rpc("acknowledge_photo_intake", {
      intake_id: reservation.intake_id,
    });
    if (ackError) {
      throw new Error("The upload finished, but could not yet be confirmed.");
    }
    update({ label: "Uploading…", progress: 1 });
    void finishPhoto(supabase, reservation.intake_id, id, detail);
    return { ok: true as const, momentId: reservation.moment_id };
  } catch (error) {
    update({
      label: "Upload failed",
      detail: error instanceof Error ? error.message : "Upload failed",
      progress: null,
      failed: true,
    });
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Extra photos on a moment already reserved by uploadPhotoMoment.
 * Uses attach_photo_to_moment and the same claim → upload → process path.
 * Does not add upload chips; the first photo's chip is unchanged.
 */
export async function attachExtraPhotos(
  supabase: SupabaseClient,
  momentId: string,
  photos: readonly { bytes: ArrayBuffer; mimeType: string }[],
) {
  for (const photo of photos) {
    try {
      const mimeType = inspectPhoto(photo.bytes, photo.mimeType);
      const sha256 = sha256Hex(photo.bytes);
      const requestKey = randomId();
      const uploadKey = randomId();
      const { data: reserved, error: reserveError } = await supabase.rpc("attach_photo_to_moment", {
        existing_moment_id: momentId,
        request_key: requestKey,
      });
      const reservation = firstRow(reserved) as { intake_id?: string } | null;
      if (reserveError || !reservation?.intake_id) {
        return { ok: false as const, message: "An extra photo could not be added." };
      }
      const { data: claimed, error: claimError } = await supabase.rpc("claim_photo_intake_upload", {
        expected_mime_type: mimeType,
        expected_sha256_hex: sha256,
        expected_size_bytes: photo.bytes.byteLength,
        intake_id: reservation.intake_id,
        upload_request_key: uploadKey,
      });
      const claim = firstRow(claimed) as
        | { bucket_id?: string; object_path?: string; state?: string }
        | null;
      if (claimError || !claim?.bucket_id || !claim.object_path) {
        return { ok: false as const, message: "An extra photo could not be added." };
      }
      if (claim.state !== "uploaded_unverified") {
        await uploadWithTus(
          claim.bucket_id,
          claim.object_path,
          photo.bytes,
          mimeType,
          {
            expected_mime_type: mimeType,
            expected_sha256: sha256,
            expected_size_bytes: photo.bytes.byteLength,
            intake_id: reservation.intake_id,
            upload_request_key: uploadKey,
          },
          () => undefined,
        );
      }
      const { error: ackError } = await supabase.rpc("acknowledge_photo_intake", {
        intake_id: reservation.intake_id,
      });
      if (ackError) return { ok: false as const, message: "An extra photo could not be added." };
      await requestPhotoProcessing(reservation.intake_id);
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "An extra photo could not be added.",
      };
    }
  }
  return { ok: true as const };
}

function percentLabel(fraction: number) {
  const percent = Math.max(0, Math.min(99, Math.round(fraction * 100)));
  return percent > 0 ? `Uploading… ${percent}%` : "Uploading…";
}

export async function retryUpload(supabase: SupabaseClient, id: string) {
  const input = retryInputs.get(id);
  if (!input) return { ok: false as const, message: "That photo is no longer on this device." };
  dismissUpload(id);
  return "durationMs" in input
    ? uploadVideoMoment(supabase, input)
    : uploadPhotoMoment(supabase, input);
}

const maximumVideoBytes = 100 * 1024 * 1024;
const maximumVideoDurationMs = 120_500;
const videoMimes = new Set(["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"]);

export type VideoUploadInput = PhotoUploadInput &
  Readonly<{
    durationMs: number;
    name?: string;
    poster?: VideoPoster | null;
  }>;

function videoMime(declared: string, name: string) {
  const normalized = declared.trim().toLowerCase();
  if (videoMimes.has(normalized)) return normalized;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const fromName =
    extension === "mp4"
      ? "video/mp4"
      : extension === "mov"
        ? "video/quicktime"
        : extension === "m4v"
          ? "video/x-m4v"
          : extension === "webm"
            ? "video/webm"
            : null;
  return fromName;
}

/** Same reserve → resumable upload → finalize path as `src/features/composer/video-upload.ts`. */
export async function uploadVideoMoment(supabase: SupabaseClient, input: VideoUploadInput) {
  const id = randomId();
  const detail = dateLabel(input.occurredOn);
  retryInputs.set(id, input);
  const update = (patch: Partial<UploadChip> & { label: string }) =>
    putChip({
      id,
      detail,
      progress: null,
      failed: false,
      done: false,
      ...patch,
    });
  update({ label: "Uploading…", progress: 0 });
  try {
    const mimeType = videoMime(input.mimeType, input.name ?? "");
    if (!mimeType) throw new Error("Choose an MP4, MOV, M4V, or WebM video.");
    if (input.bytes.byteLength < 1) throw new Error("That video is empty. Choose another one.");
    if (input.bytes.byteLength > maximumVideoBytes) {
      throw new Error("Choose a video smaller than 100 MB.");
    }
    if (
      !Number.isInteger(input.durationMs) ||
      input.durationMs < 1 ||
      input.durationMs > maximumVideoDurationMs
    ) {
      throw new Error("Choose a video about 2 minutes or shorter.");
    }
    const requestKey = randomId();
    const { data: reserved, error: reserveError } = await supabase.rpc("reserve_video_moment", {
      body: input.body,
      circle_id: input.circleId,
      duration_ms: input.durationMs,
      expected_mime_type: mimeType,
      expected_size_bytes: input.bytes.byteLength,
      journal_person_id: input.journalPersonId,
      occurred_at: input.occurredAt ?? undefined,
      occurred_on: input.occurredOn,
      occurred_timezone: input.occurredTimezone ?? undefined,
      place_name: input.placeName?.trim() ?? "",
      request_key: requestKey,
      tagged_person_ids: [...(input.taggedPersonIds ?? [])],
      audience: input.audience,
      ...(input.audience === "family" && input.circleIds?.length
        ? { circle_ids: [...input.circleIds] }
        : {}),
    });
    const reservation = firstRow(reserved) as
      | {
          bucket_id?: string;
          object_path?: string;
          request_id?: string;
          moment_id?: string;
          state?: string;
        }
      | null;
    if (reserveError || !reservation?.request_id || !reservation.moment_id) {
      throw new Error(message(reserveError, "That video moment could not be prepared."));
    }
    if (reservation.state !== "published") {
      if (!reservation.bucket_id || !reservation.object_path) {
        throw new Error("That video moment could not be prepared.");
      }
      await uploadWithTus(
        reservation.bucket_id,
        reservation.object_path,
        input.bytes,
        mimeType,
        {
          video_request_id: reservation.request_id,
          request_key: requestKey,
          expected_mime_type: mimeType,
          expected_size_bytes: input.bytes.byteLength,
          duration_ms: input.durationMs,
        },
        (fraction) => update({ label: percentLabel(fraction), progress: fraction }),
      );
      const { data: momentId, error: finalizeError } = await supabase.rpc("finalize_video_moment", {
        request_id: reservation.request_id,
      });
      if (finalizeError || momentId !== reservation.moment_id) {
        throw new Error("The upload finished, but the video could not yet be added. Try again.");
      }
    }
    if (input.poster) {
      try {
        await persistVideoPoster(supabase, reservation.moment_id, input.poster);
      } catch {
        // The video is already in the journal. The card can still draw a frame.
      }
    }
    publishChip(id);
    return { ok: true as const, momentId: reservation.moment_id };
  } catch (error) {
    update({
      label: "Upload failed",
      detail: error instanceof Error ? error.message : "Upload failed",
      progress: null,
      failed: true,
    });
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Upload failed",
    };
  }
}
