"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { localJournalIsEnabled } from "../../../config/our-days-environment";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { isJustMeCatalogItemId } from "./catalog-items";

export type CatalogActionResult = Readonly<{
  ok: boolean;
  message: string;
}>;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

export async function setJustMeCatalogPreferenceAction(input: {
  itemId: string;
  enabled: boolean;
}): Promise<CatalogActionResult> {
  if (!(await hasExpectedOrigin()) || !isJustMeCatalogItemId(input.itemId)) {
    return { ok: false, message: "That request could not be verified." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: false, message: "Preview settings are not saved." };
  }
  if (localJournalIsEnabled()) {
    const { setLocalJustMeCatalogPreference } =
      await import("@/lib/local-journal/store");
    try {
      await setLocalJustMeCatalogPreference(input.itemId, input.enabled);
    } catch {
      return { ok: false, message: "That add-on could not be updated." };
    }
    revalidatePath("/settings/family");
    revalidatePath("/people");
    revalidatePath("/family");
    return { ok: true, message: "Saved." };
  }

  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("set_just_me_catalog_preference", {
    item_id: input.itemId,
    enabled: input.enabled,
  });
  if (error) {
    return { ok: false, message: "That add-on could not be updated." };
  }
  revalidatePath("/settings/family");
  revalidatePath("/people");
  revalidatePath("/family");
  return { ok: true, message: "Saved." };
}
