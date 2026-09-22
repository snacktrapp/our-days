"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import {
  isActiveCircleToken,
  writeActiveCircleCookie,
} from "@/lib/auth/active-circle";
import {
  requireJournalAccess,
  readJournalCircleMemberships,
} from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export async function deleteCircleAction(circleId: string, name: string) {
  const requestHeaders = await headers();
  const failed = {
    ok: false,
    message:
      "This circle couldn’t be deleted. Only unused circles with no other people or history can be removed.",
  };
  if (
    !isExpectedMutationOrigin(
      requestHeaders.get("origin"),
      resolvedSiteOrigin(),
    ) ||
    typeof circleId !== "string" ||
    !isActiveCircleToken(circleId) ||
    typeof name !== "string" ||
    !name.trim()
  )
    return failed;
  const access = await requireJournalAccess();
  if (access.mode === "preview" || localJournalIsEnabled()) {
    return {
      ok: false,
      message:
        "Circle deletion is available only in the connected app. Nothing was deleted.",
    };
  }
  const memberships = await readJournalCircleMemberships();
  const target = memberships.find((item) => item.circleId === circleId);
  const replacement = memberships.find((item) => item.circleId !== circleId);
  if (!target || target.role !== "organizer") return failed;
  if (!replacement)
    return { ok: false, message: "Keep at least one circle for your journal." };
  const client = await createOurDaysServerClient();
  const { error } = await client.rpc("delete_empty_circle", {
    target_circle_id: circleId,
    expected_name: name,
  });
  if (error) return failed;
  if (access.circleId === circleId)
    await writeActiveCircleCookie(replacement.circleId);
  revalidatePath("/", "layout");
  return { ok: true, message: "Circle deleted." };
}
