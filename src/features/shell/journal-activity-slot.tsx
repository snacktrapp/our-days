import type { JournalAccess } from "@/lib/auth/journal-access";
import { loadJournalActivityNotifications } from "@/data/journal-context.server";
import { NotificationCenter } from "./notification-center";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

export async function JournalActivitySlot({
  access,
  memberNames,
}: Readonly<{
  access: AuthenticatedAccess;
  memberNames?: Readonly<Record<string, string>>;
}>) {
  const items = await loadJournalActivityNotifications(access, memberNames);
  return <NotificationCenter items={items} refreshOnOpen />;
}

export function JournalActivitySlotFallback() {
  return <NotificationCenter items={[]} refreshOnOpen />;
}
