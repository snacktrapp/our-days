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
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";

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
  const params = new URLSearchParams({ circle: circleId });
  if (name) params.set("name", name);
  return `/family?${params.toString()}`;
}

function readName(input: unknown) {
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    const value = input.get("name");
    return typeof value === "string" ? value : "";
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "name" in input &&
    typeof input.name === "string"
  ) {
    return input.name;
  }
  return "";
}

export async function createGroupAction(
  input: unknown,
): Promise<CreateGroupActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That group could not be created." };
  }
  const name = normalizeGroupName(readName(input));
  if (!name) {
    return { ok: false, message: "A group name is required." };
  }

  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    await writeActiveCircleCookie("created", name);
    redirect(createdGroupHref("created", name));
  }

  if (localJournalIsEnabled()) {
    const { createLocalCircle } = await import("@/lib/local-journal/store");
    const created = await createLocalCircle(access, name);
    await writeActiveCircleCookie(created.circleId);
    revalidatePath("/family");
    revalidatePath("/people");
    revalidatePath("/settings/family");
    redirect(createdGroupHref(created.circleId));
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("create_circle", {
    circle_name: name,
  });
  if (error || typeof data !== "string") {
    return { ok: false, message: "That group could not be created." };
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
}
