import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import {
  localJournalIsEnabled,
  supabaseResourceIsActive,
} from "../../../config/our-days-environment";
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

function isUnavailableFamilySession(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42501" &&
    candidate.message === "Family session is unavailable"
  );
}

function isTransientFamilySessionError(error: unknown) {
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
    .limit(2);
}

async function readJournalAccessStateUncached(): Promise<JournalAccessState> {
  await connection();

  if (isDesignPreviewEnabled()) return { mode: "preview" };
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const localAccess = await readLocalJournalAccess();
    if (!localAccess) return { mode: "anonymous" };
    return { mode: "authenticated", ...localAccess };
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

  let { data, error } = await readActiveMemberships(supabase, userId);
  if (error && isTransientFamilySessionError(error)) {
    ({ data, error } = await readActiveMemberships(supabase, userId));
  }

  if (error) {
    if (isUnavailableFamilySession(error)) return { mode: "anonymous" };
    throw error;
  }
  const membership = data?.[0];
  if (!membership) return { mode: "no-access" };

  return {
    mode: "authenticated",
    membershipId: membership.id,
    circleId: membership.circle_id,
    personId: membership.person_id,
    role: membership.role,
  };
}

export const readJournalAccessState = cache(readJournalAccessStateUncached);

export async function requireJournalAccess(): Promise<JournalAccess> {
  const access = await readJournalAccessState();
  if (access.mode === "anonymous") redirect("/sign-in");
  if (access.mode === "no-access") redirect("/access-unavailable");
  return access;
}

export async function requirePreviewFixtureAccess() {
  const access = await requireJournalAccess();
  if (access.mode === "authenticated") redirect("/access-unavailable");
}
