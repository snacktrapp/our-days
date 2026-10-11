import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(import.meta.dirname, "../../supabase/migrations");
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith("_moment_media_purge.sql"),
);
const migration = migrationName
  ? readFileSync(resolve(migrationsDir, migrationName), "utf8")
  : "";

describe("moment media purge migration", () => {
  it("keeps moment rows and deletes bytes only through a validator storage policy", () => {
    expect(migrationName).toBeTruthy();
    expect(migration).toContain(
      "create policy our_days_moment_media_delete_validator_purge",
    );
    expect(migration).toContain(
      "private.moment_media_path_is_purge_safe(bucket_id, name)",
    );
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("create table private.moment_media_purges");
    expect(migration).toContain("Moment media has been removed");
    expect(migration).not.toMatch(/delete\s+from\s+public\.moments/iu);
    expect(migration).not.toMatch(/delete\s+from\s+storage\.objects/iu);
    expect(migration).not.toMatch(/\bto\s+service_role\b/iu);
  });
});
