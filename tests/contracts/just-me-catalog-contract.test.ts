import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260908190000_just_me_catalog.sql",
  ),
  "utf8",
);

describe("Just me catalog database contract", () => {
  it("stores per-user catalog toggles in private with reviewed RPCs", () => {
    expect(migration).toContain(
      "create table private.just_me_catalog_preferences",
    );
    expect(migration).toContain("insights.huberman_faith");
    expect(migration).toContain("journal.daily_prayer");
    expect(migration).toContain(
      "create function public.list_just_me_catalog_preferences()",
    );
    expect(migration).toContain(
      "create function public.set_just_me_catalog_preference(",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+table\s+private\.just_me_catalog_preferences\s+to\s+(?:anon|authenticated)/iu,
    );
  });

  it("stops group Insight posts and fans out to Just me subscribers", () => {
    expect(migration).toContain("create table private.insight_source_items");
    expect(migration).toContain("audience = 'just_me'");
    expect(migration).toContain(
      "perform private.deliver_insight_source_to_subscribers(resulting_item_id)",
    );
    expect(migration).toContain("insert into private.insight_source_items (");
    expect(migration).not.toContain(
      "requested_circle_id, null, actor_membership_id, 'insight'",
    );
  });

  it("gates Daily prayer and keeps one entry per recorder day", () => {
    expect(migration).toContain("trappbrian@gmail.com");
    expect(migration).toContain("moments_one_daily_prayer_per_recorder_day");
    expect(migration).toContain("OD:daily-prayer");
    expect(migration).toContain("'daily-prayer'");
    expect(migration).toContain(
      "create function public.find_daily_prayer_moment(occurred_on date)",
    );
  });
});
