import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260904154818_insight_moments.sql",
  ),
  "utf8",
);

describe("insight moments database contract", () => {
  it("adds insight without weakening the existing kind allowlist", () => {
    expect(migration).toContain(
      "kind in ('thought', 'milestone', 'location', 'photo', 'video', 'insight')",
    );
    expect(migration).toContain("when 'insight' then");
    expect(migration).toContain(
      "requested_kind in ('photo', 'video', 'insight')",
    );
  });

  it("keeps Insights off personal journals and without a journal person", () => {
    expect(migration).toContain(
      "(kind = 'insight' and journal_person_id is null)",
    );
    expect(migration).toContain("alter column journal_person_id drop not null");
    expect(migration).toContain("left join public.people as journal_person");
  });

  it("creates Insights only through the organizer RPC", () => {
    expect(migration).toContain(
      "create function public.create_insight_moment(",
    );
    expect(migration).toContain("membership.role = 'organizer'");
    expect(migration).toContain(
      "private.is_circle_organizer(requested_circle_id)",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.moments\s+to\s+(?:anon|authenticated)/iu,
    );
  });

  it("only allows https source URLs on Insights", () => {
    expect(migration).toContain("source_url ~ '^https://[^[:space:]<>\"]+$'");
    expect(migration).toContain("(kind <> 'insight' and source_url is null)");
  });
});
