import type { SupabaseClient } from "@supabase/supabase-js";

import { profileAccent } from "./profile-accent";

export type CirclePerson = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: string;
  circleId: string;
}>;

export type CircleRoster = Readonly<{
  /** Family-facing people, including the viewer. Operations is omitted. */
  people: readonly CirclePerson[];
  memberCount: number;
}>;

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function isOperations(role: string | null | undefined, directoryKind: string | null | undefined) {
  return role === "operations" || directoryKind === "operations";
}

/**
 * Who else was part of this follows the web roster: people ordered by
 * `created_at` ascending (`journal-context.server.ts` loads that order).
 */
export function orderTaggablePeople<T extends { createdAt: string }>(people: readonly T[]) {
  return [...people].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/** People and counts for the circle chips and “Who else was part of this?”. */
export async function loadRosters(
  supabase: SupabaseClient,
  circleIds: readonly string[],
): Promise<ReadonlyMap<string, CircleRoster>> {
  const rosters = new Map<string, CircleRoster>();
  if (circleIds.length === 0) return rosters;
  const [{ data: memberships, error: membershipError }, { data: people, error: peopleError }] =
    await Promise.all([
      supabase
        .from("circle_memberships")
        .select("circle_id, person_id, role, directory_kind, status")
        .in("circle_id", [...circleIds]),
      supabase
        .from("people")
        .select("id, display_name, accent_token, circle_id, created_at")
        .in("circle_id", [...circleIds])
        .order("created_at", { ascending: true }),
    ]);
  if (membershipError || peopleError) return rosters;
  const membershipByPerson = new Map(
    (memberships ?? []).map((row) => [`${row.circle_id}:${row.person_id}`, row]),
  );
  for (const circleId of circleIds) {
    const visible = orderTaggablePeople(
      (people ?? []).flatMap((person) => {
        if (person.circle_id !== circleId || !person.id || !person.display_name) return [];
        const membership = membershipByPerson.get(`${circleId}:${person.id}`);
        if (membership?.status && membership.status !== "active") return [];
        if (isOperations(membership?.role, membership?.directory_kind)) return [];
        return [
          {
            id: person.id,
            name: person.display_name,
            initial: initialFor(person.display_name),
            accent: profileAccent(person.accent_token),
            circleId,
            createdAt: typeof person.created_at === "string" ? person.created_at : "",
          },
        ];
      }),
    ).map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.initial,
      accent: person.accent,
      circleId: person.circleId,
    }));
    rosters.set(circleId, { people: visible, memberCount: visible.length });
  }
  return rosters;
}

export function peopleCountLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}
