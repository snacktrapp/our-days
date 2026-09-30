import type { SupabaseClient } from "@supabase/supabase-js";

import { profileAccent } from "./profile-accent";

export type MentionWrite = Readonly<{
  userId: string;
  name: string;
  start: number;
  end: number;
}>;

export type MentionCandidate = Readonly<{
  userId: string;
  name: string;
  initial: string;
  accent: string;
  circleId: string;
}>;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; message: string };

function mentionFields(mentions: readonly MentionWrite[] | undefined) {
  if (!mentions || mentions.length === 0) return {};
  return {
    mentioned_user_ids: mentions.map((mention) => mention.userId),
    mention_starts: mentions.map((mention) => mention.start),
    mention_ends: mentions.map((mention) => mention.end),
  };
}

export async function createMomentNote(
  supabase: SupabaseClient,
  input: Readonly<{
    momentId: string;
    body: string;
    mentions?: readonly MentionWrite[];
  }>,
): Promise<Ok<{ noteId: string }> | Err> {
  const body = input.body.trim();
  if (!body || body.length > 1000) {
    return { ok: false, message: "Check the note and try again." };
  }
  const { data, error } = await supabase.rpc("create_moment_note", {
    moment_id: input.momentId,
    body,
    ...mentionFields(input.mentions),
  });
  if (error || typeof data !== "string") {
    return {
      ok: false,
      message: "That note could not be saved. Your words are still here.",
    };
  }
  return { ok: true, noteId: data };
}

export async function updateMomentNote(
  supabase: SupabaseClient,
  input: Readonly<{
    noteId: string;
    revision: number;
    body: string;
    mentions?: readonly MentionWrite[];
  }>,
): Promise<Ok<{ revision: number }> | Err> {
  const body = input.body.trim();
  if (!body || body.length > 1000) {
    return { ok: false, message: "Check the note and try again." };
  }
  const { data, error } = await supabase.rpc("update_moment_note", {
    note_id: input.noteId,
    expected_revision: input.revision,
    body,
    ...mentionFields(input.mentions),
  });
  if (error || typeof data !== "number") {
    return { ok: false, message: "That note could not be changed." };
  }
  return { ok: true, revision: data };
}

export async function trashMomentNote(
  supabase: SupabaseClient,
  input: Readonly<{ noteId: string; revision: number }>,
): Promise<Ok<{ revision: number }> | Err> {
  const { data, error } = await supabase.rpc("trash_moment_note", {
    note_id: input.noteId,
    expected_revision: input.revision,
  });
  if (error) {
    return { ok: false, message: "That note could not be moved to trash." };
  }
  return { ok: true, revision: typeof data === "number" ? data : input.revision };
}

export async function setMomentReaction(
  supabase: SupabaseClient,
  input: Readonly<{ momentId: string; reactionId: "held-close" | null }>,
): Promise<{ ok: true } | Err> {
  const { error } = await supabase.rpc("set_moment_reaction", {
    moment_id: input.momentId,
    reaction_type: input.reactionId,
  });
  if (error) return { ok: false, message: "That response could not be saved." };
  return { ok: true };
}

export async function setMomentNoteHeart(
  supabase: SupabaseClient,
  input: Readonly<{ noteId: string; hearted: boolean }>,
): Promise<Ok<{ revision?: number }> | Err> {
  const { data, error } = await supabase.rpc("set_moment_note_heart", {
    note_id: input.noteId,
    hearted: input.hearted,
  });
  if (error) return { ok: false, message: "That heart could not be saved." };
  return { ok: true, revision: typeof data === "number" ? data : undefined };
}

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

/** Family members who can be @mentioned, matching buildMentionableMembersByCircle. */
export async function loadMentionCandidates(
  supabase: SupabaseClient,
  circleIds: readonly string[],
): Promise<readonly MentionCandidate[]> {
  if (circleIds.length === 0) return [];
  const [{ data: memberships, error: membershipError }, { data: people, error: peopleError }] =
    await Promise.all([
      supabase
        .from("circle_memberships")
        .select("circle_id, user_id, person_id, role, directory_kind, status")
        .in("circle_id", [...circleIds]),
      supabase
        .from("people")
        .select("id, display_name, accent_token, circle_id")
        .in("circle_id", [...circleIds]),
    ]);
  if (membershipError || peopleError) return [];
  const peopleById = new Map((people ?? []).map((person) => [person.id, person]));
  const seen = new Set<string>();
  const members: MentionCandidate[] = [];
  for (const membership of memberships ?? []) {
    if (!membership.user_id || !membership.person_id) continue;
    if (membership.status && membership.status !== "active") continue;
    if (membership.role === "operations" || membership.directory_kind === "operations") continue;
    if (seen.has(membership.user_id)) continue;
    const person = peopleById.get(membership.person_id);
    const name = person?.display_name;
    if (!name) continue;
    seen.add(membership.user_id);
    members.push({
      userId: membership.user_id,
      name,
      initial: initialFor(name),
      accent: profileAccent(person.accent_token),
      circleId: membership.circle_id,
    });
  }
  return members;
}
