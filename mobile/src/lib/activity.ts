import type { SupabaseClient } from "@supabase/supabase-js";

import {
  activityMomentHref,
  entryReactionMessage,
  familyMomentPostedMessage,
  isNotifiableFamilyMoment,
  mentionNotificationMessage,
} from "../../../src/lib/activity-notifications";
import type { CircleMembership } from "./journal";

export type ActivityItem = Readonly<{
  id: string;
  actorName: string;
  message: string;
  displayDate: string;
  href: string;
  createdAt: string;
}>;

const seenKey = "our-days:seen-notifications";

function displayDate(createdAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));
}

export function readSeenActivityIds() {
  if (typeof localStorage === "undefined") return [] as string[];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey) ?? "[]");
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function rememberSeenActivity(ids: readonly string[]) {
  if (typeof localStorage === "undefined") return;
  const next = Array.from(new Set([...readSeenActivityIds(), ...ids])).slice(-100);
  try {
    localStorage.setItem(seenKey, JSON.stringify(next));
  } catch {
    // The heart still opens when storage is blocked.
  }
}

function notIn(ids: readonly string[]) {
  return `(${ids.join(",")})`;
}

/**
 * The same activity the web heart loads in loadJournalActivityNotifications:
 * family posts, comments, reactions, and mentions. A failed query leaves the
 * heart able to open an empty or partial list instead of a dead control.
 */
export async function loadActivity(
  supabase: SupabaseClient,
  circles: readonly CircleMembership[],
): Promise<readonly ActivityItem[]> {
  const membershipIds = circles.map((circle) => circle.membershipId).filter(Boolean);
  const circleIds = circles.map((circle) => circle.circleId).filter(Boolean);
  if (membershipIds.length === 0 || circleIds.length === 0) return [];
  const mine = new Set(membershipIds);
  const viewerMembershipId = membershipIds[0] ?? "";

  const names = new Map<string, string>();
  const [ownedResult, postedResult, mentionResult] = await Promise.all([
    supabase
      .from("moments")
      .select("id")
      .in("recorded_by_membership_id", membershipIds)
      .is("trashed_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("moments")
      .select("id, recorded_by_membership_id, kind, created_at, audience, moment_circles!inner(circle_id)")
      .in("moment_circles.circle_id", circleIds)
      .eq("audience", "family")
      .neq("kind", "insight")
      .not("recorded_by_membership_id", "in", notIn(membershipIds))
      .is("trashed_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.rpc("list_my_mention_notifications"),
  ]);

  const ownedIds = new Set(
    ((ownedResult.data ?? []) as { id?: string }[]).flatMap((row) => (row.id ? [row.id] : [])),
  );
  const posts = ((postedResult.data ?? []) as {
    id?: string;
    recorded_by_membership_id?: string;
    kind?: string;
    created_at?: string;
    audience?: string;
  }[]).flatMap((row) => {
    if (!row.id || !row.recorded_by_membership_id || !row.created_at || !row.kind) return [];
    if (mine.has(row.recorded_by_membership_id)) return [];
    if (
      !isNotifiableFamilyMoment({
        authorMembershipId: row.recorded_by_membership_id,
        viewerMembershipId,
        momentKind: row.kind,
        audience: row.audience,
      })
    ) {
      return [];
    }
    return [
      {
        id: `moment:${row.id}`,
        actorId: row.recorded_by_membership_id,
        message: familyMomentPostedMessage(row.kind),
        href: activityMomentHref(row.id),
        createdAt: row.created_at,
      },
    ];
  });

  const notes: {
    id: string;
    actorId: string;
    message: string;
    href: string;
    createdAt: string;
  }[] = [];
  const reactions: typeof notes = [];
  if (ownedIds.size > 0) {
    const ownedList = [...ownedIds];
    const [noteResult, reactionResult] = await Promise.all([
      supabase
        .from("moment_notes")
        .select("id, moment_id, author_membership_id, created_at")
        .in("moment_id", ownedList)
        .not("author_membership_id", "in", notIn(membershipIds))
        .is("trashed_at", null)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("moment_reactions")
        .select("id, moment_id, author_membership_id, reaction_type, created_at")
        .in("moment_id", ownedList)
        .not("author_membership_id", "in", notIn(membershipIds))
        .is("removed_at", null)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    for (const row of (noteResult.data ?? []) as {
      id?: string;
      moment_id?: string;
      author_membership_id?: string;
      created_at?: string;
    }[]) {
      if (!row.id || !row.moment_id || !row.author_membership_id || !row.created_at) continue;
      if (mine.has(row.author_membership_id) || !ownedIds.has(row.moment_id)) continue;
      notes.push({
        id: `note:${row.id}`,
        actorId: row.author_membership_id,
        message: "commented on your entry.",
        href: activityMomentHref(row.moment_id, { noteId: row.id, thread: true }),
        createdAt: row.created_at,
      });
    }
    for (const row of (reactionResult.data ?? []) as {
      id?: string;
      moment_id?: string;
      author_membership_id?: string;
      reaction_type?: string;
      created_at?: string;
    }[]) {
      if (!row.id || !row.moment_id || !row.author_membership_id || !row.created_at) continue;
      if (mine.has(row.author_membership_id) || !ownedIds.has(row.moment_id)) continue;
      reactions.push({
        id: `reaction:${row.id}:${row.reaction_type ?? ""}`,
        actorId: row.author_membership_id,
        message: entryReactionMessage(row.reaction_type ?? ""),
        href: activityMomentHref(row.moment_id, { thread: true }),
        createdAt: row.created_at,
      });
    }
  }

  const mentions = (Array.isArray(mentionResult.data) ? mentionResult.data : []).flatMap((row) => {
    const item = row as {
      mention_id?: string;
      moment_id?: string;
      note_id?: string | null;
      actor_membership_id?: string;
      actor_name?: string;
      snippet?: string;
      created_at?: string;
    };
    if (!item.mention_id || !item.moment_id || !item.created_at) return [];
    return [
      {
        id: `mention:${item.mention_id}`,
        actorId: item.actor_membership_id ?? "",
        actorName: item.actor_name,
        message: mentionNotificationMessage(item.snippet ?? ""),
        href: activityMomentHref(item.moment_id, {
          noteId: item.note_id,
          thread: Boolean(item.note_id),
        }),
        createdAt: item.created_at,
      },
    ];
  });

  const actorIds = [
    ...new Set(
      [...posts, ...notes, ...reactions, ...mentions]
        .map((item) => ("actorId" in item ? item.actorId : ""))
        .filter((id) => id && !names.has(id)),
    ),
  ];
  if (actorIds.length > 0) {
    const named = await supabase.rpc("visible_moment_authors", { membership_ids: actorIds });
    for (const author of (named.data ?? []) as { membership_id?: string; display_name?: string }[]) {
      if (author.membership_id && author.display_name) names.set(author.membership_id, author.display_name);
    }
  }

  return [...posts, ...notes, ...reactions, ...mentions]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      actorName:
        ("actorName" in item && typeof item.actorName === "string" && item.actorName) ||
        names.get(item.actorId) ||
        "Family",
      message: item.message,
      displayDate: displayDate(item.createdAt),
      href: item.href,
      createdAt: item.createdAt,
    }));
}
