/**
 * Photo and video uploads shown inline in the feed instead of the old floating
 * "Uploading…" chip: a new post appears at once as a pending card with the
 * local photo dimmed and a thin progress bar; photos added in Edit appear on
 * their post the same way. A failed upload stays on its card with Retry and
 * Remove, and survives a relaunch (web #148 keeps failed uploads in IndexedDB;
 * here the bytes go to the app's documents folder through a storage adapter).
 *
 * No React Native imports, so the e2e script runs it under Node.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachExtraPhotos,
  uploadPhotoMoment,
  uploadVideoMoment,
  type Audience,
} from "./posts";
import type { TimelineMoment } from "./journal";
import type { VideoPoster } from "./video-poster-store";

export type PendingMedia = Readonly<{
  kind: "photo" | "video";
  mimeType: string;
  name: string;
  durationMs: number | null;
  /** Local file (or blob URL on web) the card draws while it uploads. */
  uri: string;
  posterUri: string | null;
  width?: number;
  height?: number;
}>;

export type PendingPostFields = Readonly<{
  circleId: string;
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
  placeName: string;
  taggedPersonIds: readonly string[];
  taggedLabel?: string;
  audience: Audience;
  circleIds: readonly string[];
}>;

export type PendingUpload = Readonly<{
  id: string;
  /** "post": a new post. "add": photos added to `momentId` in Edit. */
  mode: "post" | "add";
  momentId: string | null;
  post: PendingPostFields;
  media: readonly PendingMedia[];
  /** 0–1 across every file. */
  progress: number;
  state: "uploading" | "failed" | "done";
  error: string | null;
  createdAt: string;
}>;

type Payload = Readonly<{ bytes: ArrayBuffer; poster: VideoPoster | null }>;

/** Native keeps bytes on disk so a failed upload can retry after a relaunch. */
export type PendingStorage = Readonly<{
  save: (jobs: readonly PendingUpload[]) => Promise<void>;
  load: () => Promise<readonly PendingUpload[]>;
  /** Saves one file; returns the local URIs the card can draw from now on. */
  putBytes: (
    jobId: string,
    index: number,
    payload: Payload,
  ) => Promise<Readonly<{ uri: string; posterUri: string | null }> | null>;
  readBytes: (jobId: string, index: number) => Promise<Payload | null>;
  drop: (jobId: string) => Promise<void>;
}>;

let jobs: readonly PendingUpload[] = [];
const payloads = new Map<string, Payload[]>();
const listeners = new Set<() => void>();
const running = new Set<string>();
let storage: PendingStorage | null = null;
let client: SupabaseClient | null = null;

export const interruptedCopy = "The upload stopped before it finished.";

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  void storage?.save(jobs.filter((job) => job.state !== "done")).catch(() => undefined);
}

function patch(id: string, next: Partial<PendingUpload>) {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...next } : job));
  emit();
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listPending() {
  return jobs;
}

export function subscribePending(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Native only: load uploads a previous launch left behind. Any that were still
 * running when the app closed come back as failed, with Retry.
 */
export async function restorePending(adapter: PendingStorage, supabase: SupabaseClient) {
  storage = adapter;
  client = supabase;
  const saved = await adapter.load().catch(() => [] as readonly PendingUpload[]);
  const known = new Set(jobs.map((job) => job.id));
  const restored = saved
    .filter((job) => !known.has(job.id))
    .map((job) =>
      job.state === "failed" ? job : { ...job, state: "failed" as const, error: interruptedCopy },
    );
  if (restored.length === 0) return;
  jobs = [...restored, ...jobs];
  emit();
}

async function payloadFor(job: PendingUpload, index: number) {
  const memory = payloads.get(job.id)?.[index];
  if (memory) return memory;
  return (await storage?.readBytes(job.id, index).catch(() => null)) ?? null;
}

async function run(supabase: SupabaseClient, id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    await runOnce(supabase, id);
  } finally {
    running.delete(id);
  }
}

async function runOnce(supabase: SupabaseClient, id: string) {
  const start = jobs.find((job) => job.id === id);
  if (!start) return;
  patch(id, { state: "uploading", error: null, progress: 0 });
  persist();
  const files: Payload[] = [];
  for (let index = 0; index < start.media.length; index += 1) {
    const payload = await payloadFor(start, index);
    if (!payload) {
      patch(id, { state: "failed", error: "This photo is no longer on this iPhone. Remove it and pick it again." });
      persist();
      return;
    }
    files.push(payload);
  }
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0) || 1;
  const before = (count: number) => files.slice(0, count).reduce((sum, file) => sum + file.bytes.byteLength, 0);
  const report = (index: number, fraction: number) =>
    patch(id, { progress: Math.min(0.99, (before(index) + fraction * (files[index]?.bytes.byteLength ?? 0)) / total) });

  let momentId = start.momentId;
  let offset = 0;
  try {
    if (start.mode === "post") {
      const first = start.media[0];
      const firstFile = files[0];
      if (!first || !firstFile) throw new Error("Choose a photo or video first.");
      const fields = {
        bytes: firstFile.bytes,
        mimeType: first.mimeType,
        circleId: start.post.circleId,
        journalPersonId: start.post.journalPersonId,
        body: start.post.body,
        occurredOn: start.post.occurredOn,
        occurredAt: start.post.occurredAt,
        occurredTimezone: start.post.occurredTimezone,
        placeName: start.post.placeName,
        taggedPersonIds: start.post.taggedPersonIds,
        audience: start.post.audience,
        circleIds: start.post.circleIds,
      };
      const hooks = { onProgress: (fraction: number) => report(0, fraction) };
      const created =
        first.kind === "video"
          ? await uploadVideoMoment(
              supabase,
              { ...fields, name: first.name || "video.mp4", durationMs: first.durationMs ?? 0, poster: firstFile.poster },
              hooks,
            )
          : await uploadPhotoMoment(supabase, fields, hooks);
      if (!created.ok) throw new Error(created.message);
      momentId = created.momentId;
      offset = 1;
      // The post exists now. If an extra photo fails, Retry only re-adds the rest.
      patch(id, { momentId });
    }
    if (!momentId) throw new Error("That post is no longer available.");
    const rest = files.slice(offset);
    if (rest.length > 0) {
      const added = await attachExtraPhotos(
        supabase,
        momentId,
        rest.map((file, index) => ({ bytes: file.bytes, mimeType: start.media[offset + index]?.mimeType ?? "image/jpeg" })),
        (index, fraction) => report(offset + index, fraction),
      );
      if (!added.ok) {
        const left = offset + added.attached;
        payloads.set(id, files.slice(left));
        await storage?.drop(id).catch(() => undefined);
        const media: PendingMedia[] = [];
        for (const [index, file] of files.slice(left).entries()) {
          const saved = (await storage?.putBytes(id, index, file).catch(() => null)) ?? null;
          const item = start.media[left + index] as PendingMedia;
          media.push(saved ? { ...item, ...saved, posterUri: saved.posterUri ?? item.posterUri } : item);
        }
        patch(id, { mode: "add", momentId, media, state: "failed", error: added.message });
        persist();
        return;
      }
    }
    patch(id, { state: "done", progress: 1, momentId });
    payloads.delete(id);
    void storage?.drop(id).catch(() => undefined);
    persist();
  } catch (error) {
    patch(id, {
      state: "failed",
      error: error instanceof Error && error.message ? error.message : "Upload failed",
      momentId,
    });
    persist();
  }
}

async function enqueue(
  supabase: SupabaseClient,
  job: Omit<PendingUpload, "id" | "progress" | "state" | "error" | "createdAt">,
  files: readonly Payload[],
) {
  client = supabase;
  const id = randomId();
  payloads.set(id, [...files]);
  jobs = [
    { ...job, id, progress: 0, state: "uploading", error: null, createdAt: new Date().toISOString() },
    ...jobs,
  ];
  emit();
  if (storage) {
    const media: PendingMedia[] = [];
    for (const [index, file] of files.entries()) {
      const saved = await storage.putBytes(id, index, file).catch(() => null);
      const item = job.media[index] as PendingMedia;
      media.push(saved ? { ...item, ...saved, posterUri: saved.posterUri ?? item.posterUri } : item);
    }
    patch(id, { media });
  }
  return { id, done: run(supabase, id).then(() => jobs.find((item) => item.id === id) ?? null) };
}

type Picked = Readonly<{
  bytes: ArrayBuffer;
  mimeType: string;
  name: string;
  kind: "photo" | "video";
  durationMs: number | null;
  previewUri: string;
  posterUri: string | null;
  poster: VideoPoster | null;
  width?: number;
  height?: number;
}>;

function mediaOf(item: Picked): PendingMedia {
  return {
    kind: item.kind,
    mimeType: item.mimeType,
    name: item.name,
    durationMs: item.durationMs,
    uri: item.previewUri,
    posterUri: item.posterUri,
    width: item.width ?? item.poster?.width,
    height: item.height ?? item.poster?.height,
  };
}

/** A new photo or video post. The sheet closes and the feed shows a pending card. */
export function queuePost(supabase: SupabaseClient, post: PendingPostFields, items: readonly Picked[]) {
  return enqueue(
    supabase,
    { mode: "post", momentId: null, post, media: items.map(mediaOf) },
    items.map((item) => ({ bytes: item.bytes, poster: item.poster })),
  );
}

/** Photos added to an existing post in Edit; they show on that post while uploading. */
export function queueAddPhotos(
  supabase: SupabaseClient,
  moment: Readonly<{ id: string; circleId: string; journalPersonId: string; occurredOn: string; audience: string }>,
  items: readonly Picked[],
) {
  return enqueue(
    supabase,
    {
      mode: "add",
      momentId: moment.id,
      post: {
        circleId: moment.circleId,
        journalPersonId: moment.journalPersonId,
        body: "",
        occurredOn: moment.occurredOn,
        occurredAt: null,
        occurredTimezone: null,
        placeName: "",
        taggedPersonIds: [],
        audience: moment.audience === "just_me" ? "just_me" : "family",
        circleIds: [],
      },
      media: items.map(mediaOf),
    },
    items.map((item) => ({ bytes: item.bytes, poster: item.poster })),
  );
}

export function retryPending(id: string, supabase: SupabaseClient | null = client) {
  if (!supabase) return Promise.resolve();
  return run(supabase, id);
}

/** Remove a failed (or finished) upload from the feed and from this iPhone. */
export function removePending(id: string) {
  if (running.has(id)) return;
  jobs = jobs.filter((job) => job.id !== id);
  payloads.delete(id);
  void storage?.drop(id).catch(() => undefined);
  persist();
  emit();
}

/** Finished uploads leave once the feed has the real post (or photos). */
export function settlePending(ids: readonly string[]) {
  const drop = new Set(ids);
  if (!jobs.some((job) => drop.has(job.id))) return;
  jobs = jobs.filter((job) => !drop.has(job.id));
  emit();
}

/** Test hook: forget every job. */
export function resetPendingForTests() {
  jobs = [];
  payloads.clear();
  running.clear();
  storage = null;
  client = null;
  emit();
}

/** The feed card for a new post still uploading (or failed). */
export function pendingMoment(
  job: PendingUpload,
  author: Readonly<{ name: string; initial: string; accent: string }>,
): TimelineMoment {
  return {
    id: `pending:${job.id}`,
    kind: job.media[0]?.kind === "video" ? "video" : "photo",
    body: job.post.body,
    title: "",
    personName: author.name,
    personInitial: author.initial,
    personAccent: author.accent,
    journalPersonId: job.post.journalPersonId,
    occurredOn: job.post.occurredOn,
    occurredAt: job.post.occurredAt,
    occurredTimezone: job.post.occurredTimezone ?? undefined,
    timePrecision: job.post.occurredAt ? undefined : "date",
    audience: job.post.audience,
    placeName: job.post.placeName || undefined,
    circleId: job.post.circleId,
    linkedCircleIds: job.post.circleIds,
    photos: [],
    hasPoster: false,
    hasVideo: job.media[0]?.kind === "video",
    canChange: false,
    revision: 0,
    taggedPeopleLabel: job.post.taggedLabel,
    taggedPersonIds: job.post.taggedPersonIds,
    mentions: [],
    notes: [],
    reactions: [],
    pending: job,
  };
}

function newer(a: Readonly<{ occurredOn: string; occurredAt: string | null }>, b: TimelineMoment) {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn > b.occurredOn;
  if (!a.occurredAt || !b.occurredAt) return true;
  return a.occurredAt >= b.occurredAt;
}

/**
 * Pending new posts at their place in the (newest first) feed. A post the
 * feed already has, from a reload after it finished, is not shown twice.
 */
export function mergePending(
  moments: readonly TimelineMoment[],
  pending: readonly PendingUpload[],
  options: Readonly<{
    listed: (post: PendingPostFields) => boolean;
    author: Readonly<{ name: string; initial: string; accent: string }>;
  }>,
): readonly TimelineMoment[] {
  const ids = new Set(moments.map((moment) => moment.id));
  const cards = pending
    .filter((job) => job.mode === "post" && !(job.momentId && ids.has(job.momentId)) && options.listed(job.post))
    .map((job) => pendingMoment(job, options.author));
  if (cards.length === 0) return moments;
  const result = [...moments];
  // Oldest first, so several pending posts end newest first.
  for (const card of [...cards].reverse()) {
    const at = result.findIndex((moment) => newer(card, moment));
    result.splice(at === -1 ? result.length : at, 0, card);
  }
  return result;
}
