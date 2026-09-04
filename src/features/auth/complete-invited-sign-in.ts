"use server";

import { redirect } from "next/navigation";
import { acceptPendingInvitationForSession } from "@/lib/auth/accept-pending-invitation.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export async function completeInvitedSignIn() {
  const supabase = await createOurDaysServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    redirect("/sign-in?link=invalid");
  }

  const { data, error: membershipError } = await supabase
    .from("circle_memberships")
    .select("circle_id")
    .limit(2);

  if (membershipError) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/sign-in?link=unavailable");
  }

  if (!data || data.length === 0) {
    const accepted = await acceptPendingInvitationForSession(supabase);
    if (!accepted) {
      redirect("/access-unavailable");
    }
  }

  redirect("/family");
}
