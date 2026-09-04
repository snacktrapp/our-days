import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260904161258_operations_membership_role.sql",
  ),
  "utf8",
);

describe("operations membership database contract", () => {
  it("adds a directory label without weakening organizer privileges", () => {
    expect(migration).toContain("add column directory_kind text");
    expect(migration).toContain(
      "check (directory_kind in ('journal', 'operations'))",
    );
    expect(migration).toContain("role = 'organizer'");
    expect(migration).not.toContain("membership.role <> 'operations'");
  });

  it("migrates TARS by Auth email, not display name", () => {
    expect(migration).toContain("tars-trapp@agentmail.to");
    expect(migration).not.toMatch(/display_name\s*=\s*'TARS'/iu);
    expect(migration).toContain("directory_kind = 'operations'");
  });

  it("keeps Operations people off journal tag lists only", () => {
    expect(migration).toContain("membership.directory_kind = 'operations'");
    expect(migration).toContain(
      "create or replace function private.tags_are_valid(",
    );
  });
});
