"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { isProfileColor } from "@/features/profile-color";

export type ProfileColorResult = { ok: boolean; message: string };

export async function saveProfileColorAction(
  color: unknown,
): Promise<ProfileColorResult> {
  const failure = {
    ok: false,
    message: "Your color couldn’t be saved. Try again.",
  };
  if (
    !isProfileColor(color) ||
    !isExpectedMutationOrigin(
      (await headers()).get("origin"),
      resolvedSiteOrigin(),
    )
  )
    return failure;
  const access = await requireJournalAccess();
  if (access.mode === "preview")
    return {
      ok: true,
      message: "Preview color updated. Your account is unchanged.",
    };
  try {
    if (localJournalIsEnabled()) {
      const { saveLocalProfileColor } =
        await import("@/lib/local-journal/store");
      await saveLocalProfileColor(access, color);
    } else {
      const client = await createOurDaysServerClient();
      const { data, error } = await client.rpc("set_my_profile_color", {
        color,
      });
      if (error || !data) return failure;
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Color saved." };
  } catch {
    return failure;
  }
}
