"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { isActiveCircleToken } from "@/lib/auth/active-circle";
import {
  requireJournalAccess,
  readJournalCircleMemberships,
} from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export async function archiveCircleAction(circleId: string, archive: boolean) {
  const requestHeaders = await headers();
  const failed = {
    ok: false,
    message: "This circle couldn’t be updated. Please try again.",
  };
  if (
    !isExpectedMutationOrigin(
      requestHeaders.get("origin"),
      resolvedSiteOrigin(),
    ) ||
    typeof circleId !== "string" ||
    !isActiveCircleToken(circleId) ||
    typeof archive !== "boolean"
  )
    return failed;
  const access = await requireJournalAccess();
  if (access.mode === "preview" || localJournalIsEnabled())
    return {
      ok: false,
      message:
        "Archiving is available in the connected app. Nothing was changed.",
    };
  const memberships = await readJournalCircleMemberships();
  if (
    !memberships.some(
      (item) => item.circleId === circleId && item.role === "organizer",
    )
  )
    return failed;
  const client = await createOurDaysServerClient();
  const { error } = await client.rpc("set_circle_archived", {
    target_circle_id: circleId,
    archive,
  });
  if (error) return failed;
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: archive ? "Circle archived." : "Circle restored.",
  };
}
