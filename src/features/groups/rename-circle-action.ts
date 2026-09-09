"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";
import {
  isActiveCircleToken,
  normalizeGroupName,
} from "@/lib/auth/active-circle";
import {
  readJournalCircleMemberships,
  requireJournalAccess,
} from "@/lib/auth/journal-access";
import { hasOrganizerPrivilege } from "@/lib/circle-roles";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export type RenameCircleActionResult = Readonly<
  { ok: true; message: string } | { ok: false; message: string }
>;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    resolvedSiteOrigin(),
  );
}

function readRenameForm(input: unknown) {
  if (input instanceof FormData) {
    const name = input.get("name");
    const circleId = input.get("circleId");
    return {
      name: typeof name === "string" ? name : "",
      circleId: typeof circleId === "string" ? circleId : "",
    };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { name: "", circleId: "" };
  }
  const record = input as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "",
    circleId: typeof record.circleId === "string" ? record.circleId : "",
  };
}

export async function renameCircleAction(
  input: unknown,
): Promise<RenameCircleActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That circle could not be renamed." };
  }
  const form = readRenameForm(input);
  const name = normalizeGroupName(form.name);
  const circleId = form.circleId;
  if (!name) {
    return { ok: false, message: "A circle name is required." };
  }
  if (!circleId || !isActiveCircleToken(circleId)) {
    return { ok: false, message: "That circle could not be renamed." };
  }

  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    return { ok: true, message: "Circle renamed." };
  }

  const memberships = await readJournalCircleMemberships();
  const target = memberships.find(
    (membership) => membership.circleId === circleId,
  );
  if (!target || !hasOrganizerPrivilege(target.role)) {
    return { ok: false, message: "That circle could not be renamed." };
  }

  if (localJournalIsEnabled()) {
    const { renameLocalCircle } = await import("@/lib/local-journal/store");
    try {
      await renameLocalCircle(access, circleId, name);
    } catch {
      return { ok: false, message: "That circle could not be renamed." };
    }
    revalidatePath("/family");
    revalidatePath("/people");
    revalidatePath("/settings/family");
    return { ok: true, message: "Circle renamed." };
  }

  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("update_circle", {
    circle_id: circleId,
    circle_name: name,
  });
  if (error) {
    return { ok: false, message: "That circle could not be renamed." };
  }
  revalidatePath("/family");
  revalidatePath("/people");
  revalidatePath("/settings/family");
  return { ok: true, message: "Circle renamed." };
}
