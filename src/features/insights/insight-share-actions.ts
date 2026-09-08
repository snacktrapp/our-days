"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { localJournalIsEnabled } from "../../../config/our-days-environment";
import {
  readJournalCircleMemberships,
  requireJournalAccess,
} from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";
import {
  formatSharedInsightMoment,
  type ShareInsightAction,
} from "./insight-share";

export type { ShareInsightAction };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

export async function shareInsightMomentAction(input: {
  momentId: string;
  circleIds: readonly string[];
}): Promise<{ ok: boolean; message: string; momentId?: string }> {
  if (!(await hasExpectedOrigin()) || !uuidPattern.test(input.momentId)) {
    return { ok: false, message: "That request could not be verified." };
  }
  const memberships = await readJournalCircleMemberships();
  const allowed = new Set(memberships.map((membership) => membership.circleId));
  const circleIds = [...new Set(input.circleIds)].filter((id) =>
    allowed.has(id),
  );
  if (circleIds.length === 0 || circleIds.some((id) => !uuidPattern.test(id))) {
    return { ok: false, message: "Choose a group to share this Insight." };
  }
  const access = await requireJournalAccess({ circleId: circleIds[0] });
  if (access.mode !== "authenticated") {
    return { ok: false, message: "Preview moments are not saved." };
  }

  let quote = "";
  let attribution = "";
  if (localJournalIsEnabled()) {
    const { readLocalInsightForShare } =
      await import("@/lib/local-journal/store");
    const insight = await readLocalInsightForShare(access, input.momentId);
    if (!insight) {
      return { ok: false, message: "That Insight could not be shared." };
    }
    quote = insight.quote;
    attribution = insight.attribution;
  } else {
    const supabase = await createOurDaysServerClient();
    const { data, error } = await supabase
      .from("moments")
      .select("kind, title, body, audience, journal_person_id")
      .eq("id", input.momentId)
      .maybeSingle();
    if (
      error ||
      !data ||
      data.kind !== "insight" ||
      data.audience !== "just_me" ||
      data.journal_person_id !== access.personId
    ) {
      return { ok: false, message: "That Insight could not be shared." };
    }
    quote = data.body;
    attribution = data.title ?? "Insight";
  }

  const result = await createFamilyMomentAction({
    journalPersonId: access.personId,
    kind: "thought",
    title: "",
    body: formatSharedInsightMoment(quote, attribution),
    placeName: "",
    taggedPersonIds: [],
    occurredOn: new Date().toISOString().slice(0, 10),
    occurredAt: null,
    occurredTimezone: null,
    audience: "family",
    circleIds,
  });
  if (result.ok) {
    revalidatePath("/family");
    revalidatePath("/people");
  }
  return result.ok
    ? { ok: true, message: "Shared to your group.", momentId: result.momentId }
    : { ok: false, message: result.message };
}
