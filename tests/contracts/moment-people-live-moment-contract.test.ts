import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260913143000_moment_people_live_moment_read.sql",
  ),
  "utf8",
);
const pgTap = readFileSync(
  resolve(root, "supabase/tests/database/moment_people_live_moment.test.sql"),
  "utf8",
);

describe("moment_people live-moment read contract", () => {
  it("selects tags with can_read_live_moment instead of primary membership", () => {
    expect(migration).toContain("drop policy moment_people_select_live_parent");
    expect(migration).toContain(
      "and (select private.can_read_live_moment(moment_id))",
    );
    expect(migration).not.toMatch(
      /moment_people_select_live_parent[\s\S]*is_active_circle_member\(circle_id\)/,
    );
  });

  it("resolves tag names through a private definer gated by live-moment read", () => {
    expect(migration).toContain(
      "create function private.moment_tagged_people(requested_moment_id uuid)",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain(
      "when not (select private.can_read_live_moment(requested_moment_id))",
    );
    expect(migration).toContain(
      "(select private.moment_tagged_people(moment.id))",
    );
  });

  it("proves Harbor-only linked-circle reads keep Cedar tag names", () => {
    expect(pgTap).toContain(
      "a Harbor-only member sees the Cedar tag name on a linked moment",
    );
    expect(pgTap).toContain(
      "a Harbor-only member can read moment_people rows on a linked Cedar-primary moment",
    );
    expect(pgTap).toContain(
      "a Harbor-only member cannot read tags on a Cedar-only moment",
    );
  });
});
