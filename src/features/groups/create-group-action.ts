"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";
import {
  isActiveCircleToken,
  normalizeGroupName,
  writeActiveCircleCookie,
} from "@/lib/auth/active-circle";
import {
  readJournalCircleMemberships,
  requireJournalAccess,
} from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { readWiderCircleForm } from "./wider-circle";

export type CreateGroupActionResult = Readonly<
  { ok: true; href: string } | { ok: false; message: string }
>;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    resolvedSiteOrigin(),
  );
}

function createdGroupHref(circleId: string, name?: string) {
  const params = new URLSearchParams({ inviteCircle: circleId });
  if (name) params.set("name", name);
  return `/settings/family?${params.toString()}#invite`;
}

async function actorBelongsToCircle(
  access: Extract<
    Awaited<ReturnType<typeof requireJournalAccess>>,
    { mode: "authenticated" }
  >,
  circleId: string,
) {
  if (circleId === access.circleId) return true;
  if (!isActiveCircleToken(circleId)) return false;
  const memberships = await readJournalCircleMemberships();
  if (memberships.some((membership) => membership.circleId === circleId)) {
    return true;
  }
  if (!localJournalIsEnabled()) return false;
  const { readLocalJournal } = await import("@/lib/local-journal/store");
  const document = await readLocalJournal();
  return (
    document.circle.id === circleId ||
    (document.extraCircles ?? []).some((circle) => circle.id === circleId)
  );
}

export async function createGroupAction(
  input: unknown,
): Promise<CreateGroupActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That circle could not be created." };
  }
  const form = readWiderCircleForm(input);
  const name = normalizeGroupName(form.name);
  const sourceCircleId = form.sourceCircleId;
  if (!name) {
    return { ok: false, message: "A circle name is required." };
  }
  if (!sourceCircleId || !isActiveCircleToken(sourceCircleId)) {
    return { ok: false, message: "That circle could not be created." };
  }

  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    await writeActiveCircleCookie("created", name);
    redirect(createdGroupHref("created", name));
  }

  if (!(await actorBelongsToCircle(access, sourceCircleId))) {
    return { ok: false, message: "That circle could not be created." };
  }

  if (localJournalIsEnabled()) {
    const { createLocalCircle } = await import("@/lib/local-journal/store");
    const created = await createLocalCircle(access, name, sourceCircleId);
    await writeActiveCircleCookie(created.circleId);
    revalidatePath("/family");
    revalidatePath("/people");
    revalidatePath("/settings/family");
    redirect(createdGroupHref(created.circleId));
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("create_circle", {
    circle_name: name,
    source_circle_id: sourceCircleId,
  });
  if (error || typeof data !== "string") {
    return { ok: false, message: "That circle could not be created." };
  }
  await writeActiveCircleCookie(data);
  revalidatePath("/family");
  revalidatePath("/people");
  revalidatePath("/settings/family");
  redirect(createdGroupHref(data));
}

export async function selectActiveGroupAction(circleId: string) {
  if (!(await hasExpectedOrigin()) || !isActiveCircleToken(circleId)) return;
  await requireJournalAccess();
  await writeActiveCircleCookie(circleId);
  revalidatePath("/family");
}
