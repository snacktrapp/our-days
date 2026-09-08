import "server-only";

import { localJournalIsEnabled } from "../../../config/our-days-environment";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  dailyPrayerCatalogItemId,
  hubermanFaithCatalogItemId,
  isJustMeCatalogItemId,
  justMeCatalogItemDefinition,
  type JustMeCatalogItemId,
  type JustMeCatalogViewModel,
} from "./catalog-items";
import {
  dailyPrayerIsAllowedForEmail,
  sessionEmailFromClaims,
} from "./daily-prayer-access";

export type { JustMeCatalogViewModel };

export function previewJustMeCatalogModel(): JustMeCatalogViewModel {
  return {
    persist: false,
    dailyPrayerEnabled: true,
    insightsEnabled: false,
    items: [
      {
        id: hubermanFaithCatalogItemId,
        title: "Insights — Huberman on faith",
        description:
          "Short quotes land on your Just me timeline. Share any of them to a group with your name.",
        enabled: false,
      },
      {
        id: dailyPrayerCatalogItemId,
        title: "Daily prayer",
        description:
          "A morning journal: thanks, how to show up, prayers, and who you are in God’s eyes.",
        enabled: true,
      },
    ],
  };
}

async function readSessionEmail() {
  if (localJournalIsEnabled()) {
    const { readLocalJournalSessionEmail } =
      await import("@/lib/local-journal/auth");
    return readLocalJournalSessionEmail();
  }
  const supabase = await createOurDaysServerClient();
  const { data } = await supabase.auth.getClaims();
  return sessionEmailFromClaims(data?.claims);
}

function itemsFromRows(
  rows: readonly { item_id?: string; enabled?: boolean }[],
  email: string | null,
) {
  const enabledIds = new Set(
    rows.flatMap((row) =>
      row.enabled && isJustMeCatalogItemId(row.item_id) ? [row.item_id] : [],
    ),
  );
  const prayerVisible = dailyPrayerIsAllowedForEmail(email);
  const visibleIds: JustMeCatalogItemId[] = [
    hubermanFaithCatalogItemId,
    ...(prayerVisible ? [dailyPrayerCatalogItemId] : []),
  ];
  return visibleIds.flatMap((id) => {
    const definition = justMeCatalogItemDefinition(id);
    if (!definition) return [];
    return [
      {
        id,
        title: definition.title,
        description: definition.description,
        enabled: enabledIds.has(id),
      },
    ];
  });
}

export async function loadJustMeCatalogModel(): Promise<JustMeCatalogViewModel> {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    return previewJustMeCatalogModel();
  }
  const email = await readSessionEmail();
  if (localJournalIsEnabled()) {
    const { listLocalJustMeCatalogPreferences } =
      await import("@/lib/local-journal/store");
    const rows = await listLocalJustMeCatalogPreferences();
    const items = itemsFromRows(rows, email);
    return {
      persist: true,
      items,
      dailyPrayerEnabled:
        dailyPrayerIsAllowedForEmail(email) &&
        items.some(
          (item) => item.id === dailyPrayerCatalogItemId && item.enabled,
        ),
      insightsEnabled: items.some(
        (item) => item.id === hubermanFaithCatalogItemId && item.enabled,
      ),
    };
  }

  const supabase = await createOurDaysServerClient();
  const { data } = await supabase.rpc("list_just_me_catalog_preferences");
  const items = itemsFromRows(data ?? [], email);
  return {
    persist: true,
    items,
    dailyPrayerEnabled:
      dailyPrayerIsAllowedForEmail(email) &&
      items.some(
        (item) => item.id === dailyPrayerCatalogItemId && item.enabled,
      ),
    insightsEnabled: items.some(
      (item) => item.id === hubermanFaithCatalogItemId && item.enabled,
    ),
  };
}

export async function loadDailyPrayerComposerFlag() {
  const catalog = await loadJustMeCatalogModel();
  return catalog.dailyPrayerEnabled;
}
