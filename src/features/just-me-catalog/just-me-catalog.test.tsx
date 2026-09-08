import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  dailyPrayerCatalogItemId,
  hubermanFaithCatalogItemId,
} from "./catalog-items";
import { JustMeCatalog } from "./just-me-catalog";

vi.mock("./catalog-actions", () => ({
  setJustMeCatalogPreferenceAction: vi.fn(),
}));

describe("Just me catalog", () => {
  it("renders Insights and Daily prayer toggles", async () => {
    const user = userEvent.setup();
    render(
      <JustMeCatalog
        model={{
          persist: false,
          dailyPrayerEnabled: true,
          insightsEnabled: false,
          items: [
            {
              id: hubermanFaithCatalogItemId,
              title: "Insights — Huberman on faith",
              description: "Short quotes land on your Just me timeline.",
              enabled: false,
            },
            {
              id: dailyPrayerCatalogItemId,
              title: "Daily prayer",
              description: "A morning journal.",
              enabled: true,
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Timeline add-ons" }),
    ).toBeVisible();
    const insights = screen.getByRole("switch", {
      name: "Insights — Huberman on faith",
    });
    const prayer = screen.getByRole("switch", { name: "Daily prayer" });
    expect(insights).toHaveAttribute("aria-checked", "false");
    expect(prayer).toHaveAttribute("aria-checked", "true");
    await user.click(insights);
    expect(insights).toHaveAttribute("aria-checked", "true");
  });
});
