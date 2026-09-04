import "server-only";

import type { createOurDaysServerClient } from "@/lib/supabase/server";

type OurDaysServerClient = Awaited<
  ReturnType<typeof createOurDaysServerClient>
>;

const membershipIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function acceptPendingInvitationForSession(
  supabase: OurDaysServerClient,
) {
  const { data, error } = await supabase.rpc(
    "accept_pending_invitation_for_current_user",
  );
  if (error) return false;
  return typeof data === "string" && membershipIdPattern.test(data);
}
