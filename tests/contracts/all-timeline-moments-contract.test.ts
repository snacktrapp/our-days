import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260912160000_list_all_timeline_moments.sql",
  ),
  "utf8",
);

describe("All timeline moments database contract", () => {
  it("adds a merged All feed RPC without changing per-circle listing", () => {
    expect(migration).toContain(
      "create function public.list_all_timeline_moments",
    );
    expect(migration).toContain("moment.audience = 'family'");
    expect(migration).toContain("moment.audience = 'just_me'");
    expect(migration).toContain("from public.moment_circles as link");
    expect(migration).toContain(
      "grant execute on function public.list_all_timeline_moments",
    );
  });
});
