import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260830153119_phase_5_family_context.sql",
  ),
  "utf8",
);
const timelineData = readFileSync(
  resolve(root, "src/data/moments.server.ts"),
  "utf8",
);

describe("family context privacy contract", () => {
  it("keeps every descendant table read-only to browsers and RLS protected", () => {
    for (const table of ["moment_people", "moment_notes", "moment_reactions"]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
    expect(migration).toMatch(
      /revoke all on table public\.moment_people, public\.moment_notes,\s+public\.moment_reactions from public, anon, authenticated/iu,
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.moment_/iu,
    );
  });

  it("binds every tag, note, and response to same-circle parents and actors", () => {
    expect(migration).toContain(
      "foreign key (circle_id, moment_id)\n    references public.moments (circle_id, id)",
    );
    expect(migration).toContain(
      "foreign key (circle_id, person_id)\n    references public.people (circle_id, id)",
    );
    expect(migration).toContain(
      "foreign key (circle_id, author_membership_id)\n    references public.circle_memberships (circle_id, id)",
    );
  });

  it("uses manual place labels without coordinates, geocoding, or location APIs", () => {
    expect(migration).toContain("add column place_name text");
    expect(migration).not.toMatch(/latitude|longitude|postgis|geocod|gps/iu);
  });

  it("enforces one constrained, reversible response per membership", () => {
    expect(migration).toContain("moment_reactions_one_per_member unique");
    expect(migration).toContain(
      "reaction_type in ('held-close', 'made-me-smile', 'remember-this')",
    );
    expect(migration).toContain("requested_reaction_type is null");
    expect(migration).toContain(
      "if reaction_subject_id is null or existing_removed_at is not null then",
    );
  });

  it("soft-removes tags without rewriting their original attribution", () => {
    expect(migration).toContain("removed_at timestamptz");
    expect(migration).toContain(
      "set removed_at = statement_timestamp()\n  where moment_id = target_moment_id",
    );
    expect(migration).toContain(
      "on conflict (circle_id, moment_id, person_id) do update\n    set removed_at = null",
    );
    expect(migration).not.toContain(
      "delete from public.moment_people where moment_id = target_moment_id",
    );
  });

  it("keeps closed conversation bodies out of timeline rows", () => {
    const timelineReturn = migration.slice(
      migration.indexOf("create function public.list_timeline_moments"),
    );
    expect(timelineReturn).not.toContain("'authorName'");
    expect(timelineReturn).not.toContain("'reactionId'");
    expect(timelineData).toContain(
      "conversation: { notes: [], reactions: [] }",
    );
  });

  it("locks the circle before descendant authorization is rechecked", () => {
    expect(
      migration.match(
        /from public\.circles where id = target_circle_id for update/gu,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("never copies family text or place labels into audit rows", () => {
    expect(migration).not.toMatch(
      /insert into private\.audit_events\s*\([^)]*(?:body|title|place_name|reaction_type)/iu,
    );
  });
});
