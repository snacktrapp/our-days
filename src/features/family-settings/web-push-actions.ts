"use server";

import { headers } from "next/headers";
import { localJournalIsEnabled } from "../../../config/our-days-environment";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { webPushIsConfigured } from "@/lib/web-push/keys";

const endpointPattern = /^https:\/\/\S{8,2048}$/u;
const urlSafeBase64Pattern = /^[A-Za-z0-9_-]+={0,2}$/u;

export type WebPushActionResult = Readonly<
  { ok: true; message: string } | { ok: false; message: string }
>;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

function validSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  return (
    endpointPattern.test(input.endpoint) &&
    urlSafeBase64Pattern.test(input.p256dh) &&
    input.p256dh.length >= 80 &&
    input.p256dh.length <= 120 &&
    urlSafeBase64Pattern.test(input.auth) &&
    input.auth.length >= 16 &&
    input.auth.length <= 40
  );
}

export async function saveWebPushSubscriptionAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<WebPushActionResult> {
  if (!(await hasExpectedOrigin()) || !validSubscription(input)) {
    return { ok: false, message: "That request could not be verified." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return {
      ok: false,
      message: "Notifications need a signed-in family journal.",
    };
  }
  if (localJournalIsEnabled() || !webPushIsConfigured()) {
    return {
      ok: false,
      message: "Phone notifications aren’t available on this journal yet.",
    };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("save_web_push_subscription", {
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
  });
  if (error) {
    return { ok: false, message: "Notifications could not be turned on." };
  }
  return { ok: true, message: "Notifications are on." };
}

export async function deleteWebPushSubscriptionAction(input: {
  endpoint: string;
}): Promise<WebPushActionResult> {
  if (!(await hasExpectedOrigin()) || !endpointPattern.test(input.endpoint)) {
    return { ok: false, message: "That request could not be verified." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: true, message: "Notifications are off." };
  }
  if (localJournalIsEnabled()) {
    return { ok: true, message: "Notifications are off." };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("delete_web_push_subscription", {
    endpoint: input.endpoint,
  });
  if (error) {
    return { ok: false, message: "Notifications could not be turned off." };
  }
  return { ok: true, message: "Notifications are off." };
}
