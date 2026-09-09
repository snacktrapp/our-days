import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260907120000_create_circle.sql"),
  "utf8",
);
const sourceMigration = readFileSync(
  resolve(root, "supabase/migrations/20260909040000_create_circle_source.sql"),
  "utf8",
);

describe("create circle contract", () => {
  it("lets any active member create an additional organizer-owned circle", () => {
    expect(migration).toContain("create function private.create_circle(");
    expect(migration).toContain("create function public.create_circle(");
    expect(migration).toContain("role,\n    status,\n    directory_kind");
    expect(migration).toContain("'organizer'");
    expect(migration).toContain("'journal'");
    expect(migration).toContain(
      "grant execute on function public.create_circle(text) to authenticated",
    );
    expect(migration).not.toContain("grant insert on table public.circles");
  });

  it("does not add leave, delete, or organizer-transfer paths", () => {
    expect(migration).not.toMatch(/delete from public\.circles/iu);
    expect(migration).not.toMatch(/transfer/iu);
    expect(migration).not.toMatch(/leave_circle|delete_circle/iu);
  });

  it("requires an explicit source circle the actor belongs to", () => {
    expect(sourceMigration).toContain("source_circle_id uuid");
    expect(sourceMigration).toContain(
      "and membership.circle_id = source_circle_id",
    );
    expect(sourceMigration).toContain("and membership.status = 'active'");
    expect(sourceMigration).toContain(
      "grant execute on function public.create_circle(text, uuid) to authenticated",
    );
    expect(sourceMigration).not.toContain("order by membership.joined_at");
  });
});
