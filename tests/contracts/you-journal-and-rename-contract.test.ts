import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260909124800_you_journal_across_circles_and_rename.sql",
  ),
  "utf8",
);

describe("YOU journal and circle rename contract", () => {
  it("lists the signed-in user's person rows across memberships on YOU", () => {
    expect(migration).toContain("viewing_own_journal boolean :=");
    expect(migration).toContain("mine.person_id = moment.journal_person_id");
    expect(migration).toContain(
      "moment.circle_id = list_timeline_moments.circle_id",
    );
    expect(migration).toContain(
      "link.circle_id = list_timeline_moments.circle_id",
    );
  });

  it("keeps circle rename starter-only without table UPDATE grants", () => {
    expect(migration).toContain("create function private.update_circle(");
    expect(migration).toContain("create function public.update_circle(");
    expect(migration).toContain(
      "membership.id = circle.created_by_membership_id",
    );
    expect(migration).toContain(
      "private.is_circle_organizer(requested_circle_id)",
    );
    expect(migration).toContain(
      "grant execute on function public.update_circle(uuid, text) to authenticated",
    );
    expect(migration).not.toContain("grant update on table public.circles");
  });
});
