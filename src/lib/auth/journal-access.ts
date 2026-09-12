import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import {
  localJournalIsEnabled,
  supabaseResourceIsActive,
} from "../../../config/our-days-environment";
import { readActiveCircleCookie } from "@/lib/auth/active-circle";
import { isDesignPreviewEnabled } from "@/lib/design-preview.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export type JournalAccess =
  | Readonly<{ mode: "preview" }>
  | Readonly<{
      mode: "authenticated";
      membershipId: string;
      circleId: string;
      personId: string;
      role: string;
    }>;

export type JournalAccessState =
  | JournalAccess
  | Readonly<{ mode: "anonymous" }>
  | Readonly<{ mode: "no-access" }>;

export type JournalAccessPreference = Readonly<{
  circleId?: string | null;
  personId?: string | null;
}>;

export type JournalCircleMembership = Readonly<{
  membershipId: string;
  circleId: string;
  personId: string;
  role: string;
  circleName?: string;
}>;

function isUnavailableFamilySession(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42501" &&
    candidate.message === "Family session is unavailable"
  );
}

export function isTransientFamilySessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  return (
    code === "PGRST301" ||
    code === "08000" ||
    code === "08003" ||
    code === "08006" ||
    code === "57014" ||
    candidate.status === 503 ||
    /jwt expired|fetch failed|failed to fetch|network|timeout/iu.test(message)
  );
}

export async function retryTransientFamilySessionQuery<
  T extends { error: unknown },
>(run: () => PromiseLike<T>): Promise<T> {
  const first = await run();
  if (!first.error || !isTransientFamilySessionError(first.error)) {
    return first;
  }
  return run();
}

type MembershipRow = Readonly<{
  id: string;
  circle_id: string;
  person_id: string;
  role: string;
}>;

function toAccess(membership: MembershipRow) {
  return {
    mode: "authenticated" as const,
    membershipId: membership.id,
    circleId: membership.circle_id,
    personId: membership.person_id,
    role: membership.role,
  };
}

export function selectJournalMembership(
  memberships: readonly MembershipRow[],
  preferredCircleId?: string | null,
) {
  if (preferredCircleId) {
    const match = memberships.find(
      (membership) => membership.circle_id === preferredCircleId,
    );
    if (match) return match;
  }
  return memberships[0] ?? null;
}

async function readActiveMemberships(
  supabase: Awaited<ReturnType<typeof createOurDaysServerClient>>,
  userId: string,
) {
  return supabase
    .from("circle_memberships")
    .select("id, circle_id, person_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(50);
}

type Identity =
  | Readonly<{ mode: "preview" }>
  | Readonly<{ mode: "anonymous" }>
  | Readonly<{ mode: "no-access" }>
  | Readonly<{
      mode: "authenticated";
      memberships: readonly MembershipRow[];
    }>;

async function readIdentityUncached(): Promise<Identity> {
  await connection();

  if (isDesignPreviewEnabled()) return { mode: "preview" };
  if (localJournalIsEnabled()) {
    const { readLocalJournalMemberships } =
      await import("@/lib/local-journal/auth");
    const memberships = await readLocalJournalMemberships();
    if (!memberships) return { mode: "anonymous" };
    if (memberships.length === 0) return { mode: "no-access" };
    return { mode: "authenticated", memberships };
  }
  if (!supabaseResourceIsActive()) {
    return { mode: "anonymous" };
  }

  const supabase = await createOurDaysServerClient();
  let claimsData;
  let claimsError;
  try {
    ({ data: claimsData, error: claimsError } =
      await supabase.auth.getClaims());
  } catch (error) {
    if (!isTransientFamilySessionError(error)) throw error;
    try {
      ({ data: claimsData, error: claimsError } =
        await supabase.auth.getClaims());
    } catch {
      return { mode: "anonymous" };
    }
  }
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string") return { mode: "anonymous" };

  const { data, error } = await retryTransientFamilySessionQuery(() =>
    readActiveMemberships(supabase, userId),
  );

  if (error) {
    if (isUnavailableFamilySession(error)) return { mode: "anonymous" };
    throw error;
  }
  if (!data?.length) return { mode: "no-access" };

  return { mode: "authenticated", memberships: data };
}

const readIdentity = cache(readIdentityUncached);

async function circleIdForPerson(
  personId: string,
  memberships: readonly MembershipRow[],
) {
  const own = memberships.find(
    (membership) => membership.person_id === personId,
  );
  if (own) return own.circle_id;
  if (localJournalIsEnabled()) {
    const { circleIdForLocalPerson } = await import("@/lib/local-journal/auth");
    return circleIdForLocalPerson(personId);
  }
  if (!supabaseResourceIsActive()) return null;
  const supabase = await createOurDaysServerClient();
  const { data } = await supabase
    .from("people")
    .select("circle_id")
    .eq("id", personId)
    .maybeSingle();
  return data?.circle_id ?? null;
}

export async function readJournalAccessState(
  preference?: JournalAccessPreference,
): Promise<JournalAccessState> {
  const identity = await readIdentity();
  if (identity.mode !== "authenticated") return identity;

  let preferredCircleId =
    preference?.circleId ?? (await readActiveCircleCookie());
  if (preference?.personId) {
    preferredCircleId =
      (await circleIdForPerson(preference.personId, identity.memberships)) ??
      preferredCircleId;
  }
  const membership = selectJournalMembership(
    identity.memberships,
    preferredCircleId,
  );
  if (!membership) return { mode: "no-access" };
  return toAccess(membership);
}

export async function readJournalCircleMemberships(): Promise<
  readonly JournalCircleMembership[]
> {
  const identity = await readIdentity();
  if (identity.mode !== "authenticated") return [];
  return identity.memberships.map((membership) => ({
    membershipId: membership.id,
    circleId: membership.circle_id,
    personId: membership.person_id,
    role: membership.role,
  }));
}

export async function requireJournalAccess(
  preference?: JournalAccessPreference,
): Promise<JournalAccess> {
  const access = await readJournalAccessState(preference);
  if (access.mode === "anonymous") redirect("/sign-in");
  if (access.mode === "no-access") redirect("/access-unavailable");
  return access;
}

export async function requirePreviewFixtureAccess() {
  const access = await requireJournalAccess();
  if (access.mode === "authenticated") redirect("/access-unavailable");
}
