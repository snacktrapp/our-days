import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260901145906_phase_4e_basic_private_video.sql",
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

describe("basic private video foundation", () => {
  it("adds video without weakening the existing moment kinds", () => {
    expect(migration).toContain(
      "kind in ('thought', 'milestone', 'location', 'photo', 'video')",
    );
    expect(migration).toContain("when 'video' then");
  });

  it("keeps originals in one private, bounded video bucket", () => {
    const bucket = between(
      "insert into storage.buckets (",
      "create policy our_days_videos_insert_exact_live_tus_claim",
    );
    expect(bucket).toMatch(
      /'our-days-videos',\s*'our-days-videos',\s*false,\s*104857600/u,
    );
    for (const mime of [
      "video/mp4",
      "video/quicktime",
      "video/x-m4v",
      "video/webm",
    ]) {
      expect(bucket).toContain(`'${mime}'`);
    }
  });

  it("allows authenticated TUS only at the server-issued exact path", () => {
    const policy = between(
      "create policy our_days_videos_insert_exact_live_tus_claim",
      "create policy our_days_videos_select_live_family",
    );
    expect(policy).toContain("for insert to authenticated");
    expect(policy).toContain("'storage.tus.upload.create'");
    expect(policy).toContain("'storage.tus.upload.part'");
    expect(policy).toContain("owner_id = (select auth.uid()::text)");
    expect(policy).toContain("private.video_upload_path_is_uploadable(");
    expect(policy).not.toContain("storage.object.upload");
    expect(policy).not.toContain("storage.object.remove");
  });

  it("rechecks the live family session and journal authority", () => {
    const reserve = between(
      "create function private.reserve_video_moment(",
      "create function private.finalize_video_moment(",
    );
    const finalize = between(
      "create function private.finalize_video_moment(",
      "create function private.get_video_moment_delivery(",
    );
    expect(reserve).toContain("private.current_family_session_is_live()");
    expect(reserve).toContain("private.can_manage_person(");
    expect(finalize).toContain(
      "private.video_requester_is_authorized(target.id)",
    );
    expect(finalize).toContain("stored_object.owner_id");
    expect(finalize).toContain("stored_object.metadata");
    expect(finalize).toContain("insert into public.moments");
    expect(finalize).toContain("insert into public.moment_videos");
  });

  it("delivers only published, untrashed videos to active family members", () => {
    const delivery = between(
      "create function private.get_video_moment_delivery(",
      "create function private.video_object_path_is_readable(",
    );
    expect(delivery).toContain("from public.moment_videos as video");
    expect(delivery).toContain("moment.kind = 'video'");
    expect(delivery).toContain("moment.trashed_at is null");
    expect(delivery).toContain("private.current_family_session_is_live()");
    expect(delivery).toContain("private.is_active_circle_member(");
  });

  it("exposes only narrow authenticated RPCs", () => {
    expect(migration).toMatch(
      /revoke all on function public\.reserve_video_moment\([\s\S]*?\), public\.finalize_video_moment\(uuid\),\s*public\.get_video_moment_delivery\(uuid\)\s*from public, anon;/u,
    );
    expect(migration).toMatch(
      /grant execute on function public\.reserve_video_moment\([\s\S]*?\), public\.finalize_video_moment\(uuid\),\s*public\.get_video_moment_delivery\(uuid\)\s*to authenticated;/u,
    );
  });
});
