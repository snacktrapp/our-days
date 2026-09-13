import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260913132814_align_display_reads_with_video_signed_urls.sql",
  ),
  "utf8",
);

function between(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("display family signed-URL reads", () => {
  it("drops the Storage operation allow-list from family display SELECT", () => {
    const policy = between(
      "create policy our_days_display_select_exact_active_derivative_lease",
      "drop policy our_days_storage_objects_closed_until_media_phase",
    );
    expect(policy).toContain("for select");
    expect(policy).toContain("to authenticated");
    expect(policy).toContain("bucket_id = 'our-days-display'");
    expect(policy).toContain("private.photo_display_path_is_readable(name)");
    expect(policy).not.toContain("allow_any_operation");
    expect(policy).not.toContain("object.get_authenticated");
    expect(policy).not.toContain("object.create_signed");
    expect(policy).not.toContain("object.sign");
  });

  it("keeps the operation allow-list on originals and display uploads only", () => {
    const closed = migration.slice(
      migration.indexOf(
        "create policy our_days_storage_objects_closed_until_media_phase",
      ),
    );
    const displayReadArm = between(
      "bucket_id = 'our-days-display'\n    and (select private.photo_display_path_is_readable(name))",
      "with check (",
    );
    expect(displayReadArm).not.toContain("allow_any_operation");
    expect(closed).toContain("'object.get_authenticated'");
    expect(closed).toContain("'object.upload'");
    expect(closed).toContain("private.photo_original_path_is_readable(name)");
    expect(closed).toContain("private.photo_display_path_is_uploadable(");
  });
});
