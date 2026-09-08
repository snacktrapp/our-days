export const hubermanFaithCatalogItemId = "insights.huberman_faith" as const;
export const dailyPrayerCatalogItemId = "journal.daily_prayer" as const;

export const justMeCatalogItemIds = [
  hubermanFaithCatalogItemId,
  dailyPrayerCatalogItemId,
] as const;

export type JustMeCatalogItemId = (typeof justMeCatalogItemIds)[number];

export type JustMeCatalogItemDefinition = Readonly<{
  id: JustMeCatalogItemId;
  title: string;
  description: string;
  gated?: "daily-prayer-email";
}>;

export const justMeCatalogItems: readonly JustMeCatalogItemDefinition[] = [
  {
    id: hubermanFaithCatalogItemId,
    title: "Insights — Huberman on faith",
    description:
      "Short quotes land on your Just me timeline. Share any of them to a group with your name.",
  },
  {
    id: dailyPrayerCatalogItemId,
    title: "Daily prayer",
    description:
      "A morning journal: thanks, how to show up, prayers, and who you are in God’s eyes.",
    gated: "daily-prayer-email",
  },
];

export function isJustMeCatalogItemId(
  value: unknown,
): value is JustMeCatalogItemId {
  return (
    typeof value === "string" &&
    (justMeCatalogItemIds as readonly string[]).includes(value)
  );
}

export function justMeCatalogItemDefinition(id: JustMeCatalogItemId) {
  return justMeCatalogItems.find((item) => item.id === id) ?? null;
}

export type JustMeCatalogItemView = Readonly<{
  id: JustMeCatalogItemId;
  title: string;
  description: string;
  enabled: boolean;
}>;

export type JustMeCatalogViewModel = Readonly<{
  items: readonly JustMeCatalogItemView[];
  persist: boolean;
  dailyPrayerEnabled: boolean;
  insightsEnabled: boolean;
}>;
