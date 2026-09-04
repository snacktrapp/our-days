import "server-only";

import type { JournalAccess } from "@/lib/auth/journal-access";
import { localJournalIsEnabled } from "../../config/our-days-environment";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { mapDatabaseAccent } from "./journal-context.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

export type TrashedMomentViewModel = Readonly<{
  id: string;
  journalPersonName: string;
  journalPersonAccent: ReturnType<typeof mapDatabaseAccent>;
  kind: "thought" | "milestone" | "location" | "insight";
  title?: string;
  body: string;
  placeName?: string;
  occurredOn: string;
  revision: number;
}>;

export async function loadManageableTrash(
  access: AuthenticatedAccess,
): Promise<readonly TrashedMomentViewModel[]> {
  if (localJournalIsEnabled()) {
    const { loadLocalTrash } = await import("@/lib/local-journal/views");
    return loadLocalTrash(access);
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc(
    "list_manageable_trashed_written_moments",
    { circle_id: access.circleId },
  );
  if (error) throw error;
  return (data ?? []).map((moment) => ({
    id: moment.moment_id,
    journalPersonName:
      moment.moment_kind === "insight"
        ? "Insight"
        : (moment.journal_person_name ?? "Family"),
    journalPersonAccent: mapDatabaseAccent(
      moment.journal_person_accent ?? "clay",
    ),
    kind:
      moment.moment_kind === "milestone" ||
      moment.moment_kind === "location" ||
      moment.moment_kind === "insight"
        ? moment.moment_kind
        : "thought",
    title: moment.moment_title ?? undefined,
    body: moment.body,
    placeName: moment.place_name ?? undefined,
    occurredOn: moment.occurred_on,
    revision: moment.revision,
  }));
}
