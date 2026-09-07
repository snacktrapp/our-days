import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260907204138_moment_circles.sql",
  ),
  "utf8",
);

describe("moment_circles database contract", () => {
  it("adds a unique moment/circle junction and keeps circle_id as primary", () => {
    expect(migration).toContain("create table public.moment_circles");
    expect(migration).toContain("primary key (moment_id, circle_id)");
    expect(migration).toContain("moments.circle_id stays the primary circle");
  });

  it("keeps Just Me off the junction and readable only to the recorder", () => {
    expect(migration).toContain("moment.audience = 'just_me'");
    expect(migration).toContain(
      "delete from public.moment_circles where moment_id = new.id",
    );
    expect(migration).toContain("private.can_read_live_moment(id)");
  });

  it("lists family feeds from the junction instead of moments.circle_id", () => {
    expect(migration).toContain("from public.moment_circles as link");
    expect(migration).toContain(
      "link.circle_id = list_timeline_moments.circle_id",
    );
    expect(migration).toContain(
      "left join public.circle_memberships as recorder_membership",
    );
  });

  it("does not grant authenticated writes on the junction", () => {
    expect(migration).toContain(
      "grant select on table public.moment_circles to authenticated",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.moment_circles\s+to\s+(?:anon|authenticated)/iu,
    );
  });
});
