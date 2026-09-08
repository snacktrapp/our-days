"use server";

import { localJournalIsEnabled } from "../../../config/our-days-environment";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { parseDailyPrayerMoment } from "./daily-prayer";

export type TodaysDailyPrayer = Readonly<{
  momentId: string;
  revision: number;
  body: string;
  occurredOn: string;
}>;

export async function findTodaysDailyPrayerAction(
  occurredOn: string,
): Promise<TodaysDailyPrayer | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(occurredOn)) return null;
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") return null;

  if (localJournalIsEnabled()) {
    const { findLocalDailyPrayerMoment } =
      await import("@/lib/local-journal/store");
    const found = await findLocalDailyPrayerMoment(occurredOn);
    if (!found || !parseDailyPrayerMoment(found.body)) return null;
    return found;
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("find_daily_prayer_moment", {
    occurred_on: occurredOn,
  });
  const row = data?.[0];
  if (error || !row || !parseDailyPrayerMoment(row.body)) return null;
  return {
    momentId: row.moment_id,
    revision: Number(row.revision),
    body: row.body,
    occurredOn: row.occurred_on,
  };
}
