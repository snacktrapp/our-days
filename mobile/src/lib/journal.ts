import type { SupabaseClient } from "@supabase/supabase-js";

import { circleToday } from "./dates";

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

export type TimelineMoment = Readonly<{
  id: string;
  kind: string;
  body: string;
  title: string;
  personName: string;
  occurredOn: string;
  occurredAt: string | null;
  audience: string;
  sourceUrl?: string;
  placeName?: string;
  recorderName?: string;
  circleId: string;
  linkedCircleIds: readonly string[];
  photos: readonly TimelinePhoto[];
  hasPoster: boolean;
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
  occurred_on: string;
  occurred_at: string | null;
  moment_audience: string | null;
  source_url: string | null;
  place_name: string | null;
  recorder_person_name: string | null;
  moment_circle_id: string;
  linked_circle_ids: string[] | null;
  feed_snapshot_at: string | null;
}>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const codePattern = /^\d{6}$/u;

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

async function enrichMoments(
  supabase: SupabaseClient,
  rows: readonly TimelineRow[],
): Promise<TimelineMoment[]> {
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
          .select("moment_id")
          .in("moment_id", posterIds),
  ]);

  const photosByMoment = new Map<string, TimelinePhoto[]>();
  if (!photosResult.error) {
    for (const row of photosResult.data ?? []) {
      if (typeof row.moment_id !== "string" || typeof row.id !== "string") {
        continue;
      }
      const current = photosByMoment.get(row.moment_id) ?? [];
      current.push({
        id: row.id,
        sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
        width:
          typeof row.display_width === "number" ? row.display_width : undefined,
        height:
          typeof row.display_height === "number"
            ? row.display_height
            : undefined,
      });
      photosByMoment.set(row.moment_id, current);
    }
  }

  const posterMoments = new Set<string>();
  if (!postersResult.error) {
    for (const row of postersResult.data ?? []) {
      if (typeof row.moment_id === "string") posterMoments.add(row.moment_id);
    }
  }

  return rows.map((row) => ({
    id: row.moment_id,
    kind: row.moment_kind,
    body: row.body ?? "",
    title: row.moment_title ?? "",
    personName: row.journal_person_name ?? "Family",
    occurredOn: row.occurred_on,
    occurredAt: row.occurred_at,
    audience: row.moment_audience ?? "family",
    sourceUrl: row.source_url ?? undefined,
    placeName: row.place_name ?? undefined,
    recorderName: row.recorder_person_name ?? undefined,
    circleId: row.moment_circle_id,
    linkedCircleIds: row.linked_circle_ids ?? [row.moment_circle_id],
    photos: photosByMoment.get(row.moment_id) ?? [],
    hasPoster: posterMoments.has(row.moment_id),
  }));
}

export async function loadTimelinePage(
  supabase: SupabaseClient,
  input: Readonly<{
    circleId: string | null;
    cursor?: TimelineMoment;
    snapshotAt?: string;
    fallbackCircleId?: string;
  }>,
): Promise<TimelinePage> {
  const pageArgs = {
    page_size: pageSize + 1,
    snapshot_at: input.snapshotAt,
    ...cursorArgs(input.cursor),
  };
  const runAll = () => supabase.rpc("list_all_timeline_moments", pageArgs);
  const runCircle = (circleId: string) =>
    supabase.rpc("list_timeline_moments", {
      circle_id: circleId,
      ...pageArgs,
    });

  let usingCircleId = input.circleId;
  let fellBackToCircleId: string | undefined;
  let { data, error } = usingCircleId
    ? await runCircle(usingCircleId)
    : await runAll();

  if (error && !usingCircleId && input.fallbackCircleId && !input.cursor) {
    usingCircleId = input.fallbackCircleId;
    fellBackToCircleId = input.fallbackCircleId;
    ({ data, error } = await runCircle(usingCircleId));
  }
  if (error) throw error;

  const rows = (data ?? []) as TimelineRow[];
  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);
  const moments = await enrichMoments(supabase, visible);
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
