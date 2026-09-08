import { describe, expect, it } from "vitest";
import {
  dailyPrayerCatalogItemId,
  hubermanFaithCatalogItemId,
  isJustMeCatalogItemId,
  justMeCatalogItems,
} from "./catalog-items";
import {
  dailyPrayerIsAllowedForEmail,
  normalizeAccountEmail,
  sessionEmailFromClaims,
} from "./daily-prayer-access";

describe("just me catalog items", () => {
  it("keeps Insights and Daily prayer as the first extensible items", () => {
    expect(justMeCatalogItems.map((item) => item.id)).toEqual([
      hubermanFaithCatalogItemId,
      dailyPrayerCatalogItemId,
    ]);
    expect(justMeCatalogItems[1]?.gated).toBe("daily-prayer-email");
    expect(isJustMeCatalogItemId("insights.huberman_faith")).toBe(true);
    expect(isJustMeCatalogItemId("journal.evening_prayer")).toBe(false);
  });
});

describe("daily prayer email allowlist", () => {
  it("allows only the preview account email", () => {
    expect(dailyPrayerIsAllowedForEmail("trappbrian@gmail.com")).toBe(true);
    expect(dailyPrayerIsAllowedForEmail(" TrappBrian@Gmail.com ")).toBe(true);
    expect(dailyPrayerIsAllowedForEmail("member@example.test")).toBe(false);
    expect(dailyPrayerIsAllowedForEmail(null)).toBe(false);
    expect(normalizeAccountEmail("  A@B.com ")).toBe("a@b.com");
    expect(sessionEmailFromClaims({ email: "trappbrian@gmail.com" })).toBe(
      "trappbrian@gmail.com",
    );
    expect(sessionEmailFromClaims({ sub: "user" })).toBeNull();
  });
});
