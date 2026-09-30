import type { SupabaseClient } from "@supabase/supabase-js";

import { circleToday } from "./dates";
import { personInitial, type MentionSpan } from "./feed-format";
import { profileAccent } from "./tokens";

const pageSize = 20;

export type CircleMembership = Readonly<{
  membershipId: string;
  circleId: string;
  personId: string;
  role: string;
  name: string;
  timeZone: string;
}>;

export type TimelinePhoto = Readonly<{
  id: string;
  sortOrder: number;
  width?: number;
  height?: number;
}>;

export type FeedNote = Readonly<{
  id: string;
  authorName: string;
  authorAccent: string;
  body: string;
  createdAt: string;
  heartCount: number;
  heartedByViewer: boolean;
  heartNames: readonly string[];
  canChange: boolean;
  mentions: readonly MentionSpan[];
}>;

export type FeedReaction = Readonly<{
  id: string;
  personName: string;
  reactionId: string;
  isCurrentMember: boolean;
}>;

export type TimelineMoment = Readonly<{
  id: string;
  kind: string;
  body: string;
  title: string;
  personName: string;
  personInitial: string;
  personAccent: string;
  journalPersonId: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone?: string;
  timePrecision?: string;
  audience: string;
  sourceUrl?: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
  recorderName?: string;
  circleId: string;
  linkedCircleIds: readonly string[];
  photos: readonly TimelinePhoto[];
  hasPoster: boolean;
  posterWidth?: number;
  posterHeight?: number;
  canChange: boolean;
  taggedPeopleLabel?: string;
  mentions: readonly MentionSpan[];
  notes: readonly FeedNote[];
  reactions: readonly FeedReaction[];
}>;

export type TimelinePage = Readonly<{
  moments: readonly TimelineMoment[];
  hasMore: boolean;
  snapshotAt?: string;
  cursor?: TimelineMoment;
  fellBackToCircleId?: string;
}>;

type TimelineRow = Readonly<{
  moment_id: string;
  moment_kind: string;
  body: string | null;
  moment_title: string | null;
  journal_person_name: string | null;
  journal_person_accent?: string | null;
  moment_journal_person_id?: string | null;
  occurred_on: string;
  occurred_at: string | null;
  occurred_timezone?: string | null;
  time_precision?: string | null;
  moment_audience: string | null;
  source_url: string | null;
  place_name: string | null;
  latitude?: number | null;
  longitude?: number | null;
  recorder_person_name: string | null;
  moment_circle_id: string;
  linked_circle_ids: string[] | null;
  tagged_people?: unknown;
  can_change?: boolean | null;
  feed_snapshot_at: string | null;
}>;

type Enrichment = Readonly<{
  photos: readonly Record<string, unknown>[];
  videos: readonly Record<string, unknown>[];
  posters: readonly Record<string, unknown>[];
  notes: readonly Record<string, unknown>[];
  reactions: readonly Record<string, unknown>[];
  hearts: readonly Record<string, unknown>[];
  mentions: readonly Record<string, unknown>[];
  authors: readonly Record<string, unknown>[];
}>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const codePattern = /^\d{6}$/u;
const knownReactions = new Set([
  "held-close",
  "made-me-smile",
  "remember-this",
]);

export function validEmail(value: string) {
  const email = value.trim().toLowerCase();
  return emailPattern.test(email) && email.length <= 254;
}

export function validCode(value: string) {
  return codePattern.test(value.trim());
}

export function validThought(value: string) {
  const body = value.trim();
  return body.length > 0 && body.length <= 4000;
}

export async function loadCircles(
  supabase: SupabaseClient,
  userId: string,
): Promise<readonly CircleMembership[]> {
  const { data, error } = await supabase
    .from("circle_memberships")
    .select("id, circle_id, person_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  const memberships = data ?? [];
  const circleIds = [...new Set(memberships.map((row) => row.circle_id))];
  if (circleIds.length === 0) return [];

  const { data: circles, error: circleError } = await supabase
    .from("circles")
    .select("id, name, time_zone")
    .in("id", circleIds);
  if (circleError) throw circleError;

  const byId = new Map((circles ?? []).map((circle) => [circle.id, circle]));
  return memberships.map((membership) => {
    const circle = byId.get(membership.circle_id);
    return {
      membershipId: membership.id,
      circleId: membership.circle_id,
      personId: membership.person_id,
      role: membership.role,
      name: circle?.name ?? "Circle",
      timeZone: circle?.time_zone ?? "UTC",
    };
  });
}

function cursorArgs(cursor: TimelineMoment | undefined) {
  if (!cursor) return {};
  return {
    cursor_occurred_on: cursor.occurredOn,
    cursor_has_precise_time: cursor.occurredAt !== null,
    cursor_occurred_at: cursor.occurredAt ?? undefined,
    cursor_moment_id: cursor.id,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asRows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isEnrichment(value: unknown): value is Enrichment {
  const record = asRecord(value);
  if (!record) return false;
  return (
    Array.isArray(record.photos) &&
    Array.isArray(record.notes) &&
    Array.isArray(record.reactions) &&
    Array.isArray(record.hearts) &&
    Array.isArray(record.mentions) &&
    Array.isArray(record.authors) &&
    Array.isArray(record.posters)
  );
}

function mentionFrom(row: Record<string, unknown>): MentionSpan | null {
  const userId = text(row.mentioned_user_id);
  if (!userId) return null;
  const start = row.start_offset;
  const end = row.end_offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return {
    userId,
    start,
    end,
    name: row.active ? (text(row.display_name) ?? null) : null,
    active: row.active === true,
  };
}

function taggedLabel(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((item) => {
    const record = asRecord(item);
    const name = record ? text(record.name) : undefined;
    return name ? [name] : [];
  });
  return names.length > 0 ? names.join(", ") : undefined;
}

async function loadEnrichment(
  supabase: SupabaseClient,
  momentIds: readonly string[],
) {
  if (momentIds.length === 0) return null;
  const { data, error } = await supabase.rpc("enrich_timeline_page", {
    moment_ids: [...new Set(momentIds)],
  });
  if (error || !isEnrichment(data)) return null;
  return {
    photos: asRows(data.photos),
    videos: asRows(data.videos),
    posters: asRows(data.posters),
    notes: asRows(data.notes),
    reactions: asRows(data.reactions),
    hearts: asRows(data.hearts),
    mentions: asRows(data.mentions),
    authors: asRows(data.authors),
  } satisfies Enrichment;
}

async function fallbackPhotos(
  supabase: SupabaseClient,
  rows: readonly TimelineRow[],
) {
  const photoIds = rows
    .filter((row) => row.moment_kind === "photo")
    .map((row) => row.moment_id);
  const posterIds = rows
    .filter(
      (row) => row.moment_kind === "video" || row.moment_kind === "insight",
    )
    .map((row) => row.moment_id);
  const [photosResult, postersResult] = await Promise.all([
    photoIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("moment_photos")
          .select("id, moment_id, sort_order, display_width, display_height")
          .in("moment_id", photoIds)
          .order("sort_order", { ascending: true }),
    posterIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("moment_video_posters")
          .select("moment_id, width_px, height_px")
          .in("moment_id", posterIds),
  ]);
  return {
    photos: photosResult.error ? [] : (photosResult.data ?? []),
    posters: postersResult.error ? [] : (postersResult.data ?? []),
  };
}

async function enrichMoments(
  supabase: SupabaseClient,
  rows: readonly TimelineRow[],
  viewerMembershipIds: ReadonlySet<string>,
): Promise<TimelineMoment[]> {
  const enrichment = await loadEnrichment(
    supabase,
    rows.map((row) => row.moment_id),
  );
  const fallback = enrichment
    ? null
    : await fallbackPhotos(supabase, rows);

  const photosByMoment = new Map<string, TimelinePhoto[]>();
  const photoRows = enrichment ? enrichment.photos : (fallback?.photos ?? []);
  for (const row of photoRows) {
    const momentId = text(row.moment_id);
    const id = text(row.id);
    if (!momentId || !id) continue;
    const current = photosByMoment.get(momentId) ?? [];
    current.push({
      id,
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
      width: typeof row.display_width === "number" ? row.display_width : undefined,
      height:
        typeof row.display_height === "number" ? row.display_height : undefined,
    });
    photosByMoment.set(momentId, current);
  }

  const posters = new Map<string, { width?: number; height?: number }>();
  const posterRows = enrichment ? enrichment.posters : (fallback?.posters ?? []);
  for (const row of posterRows) {
    const momentId = text(row.moment_id);
    if (!momentId) continue;
    posters.set(momentId, {
      width: typeof row.width_px === "number" ? row.width_px : undefined,
      height: typeof row.height_px === "number" ? row.height_px : undefined,
    });
  }

  const authors = new Map<string, { name: string; accent: string }>();
  for (const row of enrichment?.authors ?? []) {
    const id = text(row.membership_id);
    if (!id) continue;
    authors.set(id, {
      name: text(row.display_name) ?? "Family",
      accent: profileAccent(text(row.accent_token)),
    });
  }

  const mentionsByNote = new Map<string, MentionSpan[]>();
  const mentionsByMoment = new Map<string, MentionSpan[]>();
  for (const row of enrichment?.mentions ?? []) {
    const mention = mentionFrom(row);
    if (!mention) continue;
    const noteId = text(row.note_id);
    const momentId = text(row.moment_id);
    if (noteId) {
      const list = mentionsByNote.get(noteId) ?? [];
      list.push(mention);
      mentionsByNote.set(noteId, list);
    } else if (momentId) {
      const list = mentionsByMoment.get(momentId) ?? [];
      list.push(mention);
      mentionsByMoment.set(momentId, list);
    }
  }

  const heartsByNote = new Map<string, Record<string, unknown>[]>();
  for (const row of enrichment?.hearts ?? []) {
    const noteId = text(row.note_id);
    if (!noteId) continue;
    const list = heartsByNote.get(noteId) ?? [];
    list.push(row);
    heartsByNote.set(noteId, list);
  }

  const notesByMoment = new Map<string, FeedNote[]>();
  for (const row of enrichment?.notes ?? []) {
    const momentId = text(row.moment_id);
    const id = text(row.id);
    const createdAt = text(row.created_at);
    if (!momentId || !id || !createdAt) continue;
    const membershipId = text(row.author_membership_id) ?? "";
    const author = authors.get(membershipId);
    const authorName = author?.name ?? "Family";
    const noteHearts = heartsByNote.get(id) ?? [];
    const list = notesByMoment.get(momentId) ?? [];
    list.push({
      id,
      authorName,
      authorAccent: author?.accent ?? "slate",
      body: text(row.body) ?? "",
      createdAt,
      heartCount: noteHearts.length,
      heartedByViewer: noteHearts.some((heart) =>
        viewerMembershipIds.has(text(heart.author_membership_id) ?? ""),
      ),
      heartNames: noteHearts.map(
        (heart) =>
          authors.get(text(heart.author_membership_id) ?? "")?.name ?? "Family",
      ),
      canChange: viewerMembershipIds.has(membershipId),
      mentions: mentionsByNote.get(id) ?? [],
    });
    notesByMoment.set(momentId, list);
  }

  const reactionsByMoment = new Map<string, FeedReaction[]>();
  for (const row of enrichment?.reactions ?? []) {
    const momentId = text(row.moment_id);
    const id = text(row.id);
    const reactionId = text(row.reaction_type);
    if (!momentId || !id || !reactionId || !knownReactions.has(reactionId)) {
      continue;
    }
    const membershipId = text(row.author_membership_id) ?? "";
    const list = reactionsByMoment.get(momentId) ?? [];
    list.push({
      id,
      personName: authors.get(membershipId)?.name ?? "Family",
      reactionId,
      isCurrentMember: viewerMembershipIds.has(membershipId),
    });
    reactionsByMoment.set(momentId, list);
  }

  return rows.map((row) => {
    const personName = row.journal_person_name ?? "Family";
    const poster = posters.get(row.moment_id);
    return {
      id: row.moment_id,
      kind: row.moment_kind,
      body: row.body ?? "",
      title: row.moment_title ?? "",
      personName,
      personInitial: personInitial(personName),
      personAccent: profileAccent(row.journal_person_accent),
      journalPersonId: row.moment_journal_person_id ?? "",
      occurredOn: row.occurred_on,
      occurredAt: row.occurred_at,
      occurredTimezone: row.occurred_timezone ?? undefined,
      timePrecision: row.time_precision ?? undefined,
      audience: row.moment_audience === "just_me" ? "just_me" : "family",
      sourceUrl: row.source_url ?? undefined,
      placeName: row.place_name ?? undefined,
      latitude: typeof row.latitude === "number" ? row.latitude : undefined,
      longitude: typeof row.longitude === "number" ? row.longitude : undefined,
      recorderName: row.recorder_person_name ?? undefined,
      circleId: row.moment_circle_id,
      linkedCircleIds:
        row.moment_audience === "just_me"
          ? []
          : row.linked_circle_ids && row.linked_circle_ids.length > 0
            ? row.linked_circle_ids
            : [row.moment_circle_id],
      photos: photosByMoment.get(row.moment_id) ?? [],
      hasPoster: posters.has(row.moment_id),
      posterWidth: poster?.width,
      posterHeight: poster?.height,
      canChange: row.can_change === true,
      taggedPeopleLabel: taggedLabel(row.tagged_people),
      mentions: mentionsByMoment.get(row.moment_id) ?? [],
      notes: notesByMoment.get(row.moment_id) ?? [],
      reactions: reactionsByMoment.get(row.moment_id) ?? [],
    };
  });
}

function compareRows(left: TimelineRow, right: TimelineRow) {
  if (left.occurred_on !== right.occurred_on) {
    return left.occurred_on < right.occurred_on ? 1 : -1;
  }
  const leftPrecise = left.occurred_at !== null;
  const rightPrecise = right.occurred_at !== null;
  if (leftPrecise !== rightPrecise) return leftPrecise ? -1 : 1;
  if (
    left.occurred_at &&
    right.occurred_at &&
    left.occurred_at !== right.occurred_at
  ) {
    return left.occurred_at < right.occurred_at ? 1 : -1;
  }
  return left.moment_id < right.moment_id ? 1 : -1;
}

export async function loadTimelinePage(
  supabase: SupabaseClient,
  input: Readonly<{
    circleId: string | null;
    cursor?: TimelineMoment;
    snapshotAt?: string;
    fallbackCircleId?: string;
    viewerMembershipIds?: readonly string[];
    /** Just me: one query per membership, merged like the personal journal. */
    personal?: readonly Pick<CircleMembership, "circleId" | "personId">[];
  }>,
): Promise<TimelinePage> {
  const pageArgs = {
    page_size: pageSize + 1,
    snapshot_at: input.snapshotAt,
    ...cursorArgs(input.cursor),
  };
  const viewerMembershipIds = new Set(input.viewerMembershipIds ?? []);

  let usingCircleId = input.circleId;
  let fellBackToCircleId: string | undefined;
  let rows: TimelineRow[];

  if (input.personal && input.personal.length > 0 && !input.circleId) {
    const pages = await Promise.all(
      input.personal.map((person) =>
        supabase.rpc("list_timeline_moments", {
          circle_id: person.circleId,
          journal_person_id: person.personId,
          ...pageArgs,
        }),
      ),
    );
    const failed = pages.find((page) => page.error);
    if (failed?.error) throw failed.error;
    const merged = new Map<string, TimelineRow>();
    for (const page of pages) {
      for (const row of (page.data ?? []) as TimelineRow[]) {
        merged.set(row.moment_id, row);
      }
    }
    rows = [...merged.values()].sort(compareRows);
  } else {
    const runAll = () => supabase.rpc("list_all_timeline_moments", pageArgs);
    const runCircle = (circleId: string) =>
      supabase.rpc("list_timeline_moments", {
        circle_id: circleId,
        ...pageArgs,
      });
    let { data, error } = usingCircleId
      ? await runCircle(usingCircleId)
      : await runAll();
    if (error && !usingCircleId && input.fallbackCircleId && !input.cursor) {
      usingCircleId = input.fallbackCircleId;
      fellBackToCircleId = input.fallbackCircleId;
      ({ data, error } = await runCircle(usingCircleId));
    }
    if (error) throw error;
    rows = (data ?? []) as TimelineRow[];
  }

  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);
  const moments = await enrichMoments(supabase, visible, viewerMembershipIds);
  return {
    moments,
    hasMore,
    snapshotAt: input.snapshotAt ?? visible[0]?.feed_snapshot_at ?? undefined,
    cursor: moments.at(-1),
    fellBackToCircleId,
  };
}

export function photoDeliveryPath(momentId: string, photoId?: string) {
  const params = new URLSearchParams();
  if (photoId) params.set("photo", photoId);
  params.set("w", "1080");
  return `/api/media/moments/${momentId}?${params.toString()}`;
}

export function videoPosterPath(momentId: string) {
  return `/api/media/videos/${momentId}/poster`;
}

export async function postThought(
  supabase: SupabaseClient,
  input: Readonly<{
    circleId: string;
    journalPersonId: string;
    body: string;
    timeZone: string;
  }>,
) {
  const body = input.body.trim();
  const { data, error } = await supabase.rpc("create_written_moment", {
    circle_id: input.circleId,
    journal_person_id: input.journalPersonId,
    body,
    occurred_on: circleToday(input.timeZone),
    audience: "family",
  });
  if (error || typeof data !== "string" || data.length === 0) {
    throw error ?? new Error("Moment could not be created");
  }
  return data;
}
