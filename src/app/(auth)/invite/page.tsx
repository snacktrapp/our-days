import { InviteEntry } from "@/features/auth/invite-entry";
import { readInvitationIntent } from "@/lib/auth/invitation-intent.server";
import { redirect } from "next/navigation";

export default async function InvitePage() {
  if (process.env.OUR_DAYS_RESOURCE_MODE !== "supabase") redirect("/sign-in");
  return (
    <InviteEntry hasStagedIntent={Boolean(await readInvitationIntent())} />
  );
}
