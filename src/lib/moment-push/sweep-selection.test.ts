import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOMENT_PUSH_FALLBACK_MS,
  MOMENT_PUSH_SWEEP_NOT_BEFORE_ISO,
} from "./constants";
import {
  momentIsDueForPushSweep,
  type MomentPushSweepCandidate,
} from "./sweep-selection";

const floor = Date.parse(MOMENT_PUSH_SWEEP_NOT_BEFORE_ISO);
const stuckPost = Date.parse("2026-10-05T16:49:39.000Z");

function candidate(
  input: Partial<MomentPushSweepCandidate> = {},
): MomentPushSweepCandidate {
  return {
    scheduledAt: floor,
    notifiedAt: null,
    mediaReady: true,
    trashed: false,
    kind: "photo",
    audience: "family",
    ...input,
  };
}

describe("moment push sweep selection", () => {
  it("does not select the Oct 5 stuck post or anything scheduled before the cutoff", () => {
    const now = Date.parse("2026-10-05T23:00:00.000Z");
    expect(
      momentIsDueForPushSweep(candidate({ scheduledAt: stuckPost }), now),
    ).toBe(false);
    expect(
      momentIsDueForPushSweep(
        candidate({ scheduledAt: floor - 1, mediaReady: true }),
        floor + 60_000,
      ),
    ).toBe(false);
  });

  it("selects a ready post scheduled on or after the cutoff", () => {
    expect(momentIsDueForPushSweep(candidate(), floor - 60_000)).toBe(true);
    expect(
      momentIsDueForPushSweep(
        candidate({ scheduledAt: floor + 60_000 }),
        floor + 120_000,
      ),
    ).toBe(true);
  });

  it("waits for unfinished media until the fallback, then selects once", () => {
    const scheduledAt = floor + 60_000;
    const waiting = candidate({
      scheduledAt,
      mediaReady: false,
      kind: "video",
    });
    expect(
      momentIsDueForPushSweep(
        waiting,
        scheduledAt + MOMENT_PUSH_FALLBACK_MS - 1,
      ),
    ).toBe(false);
    expect(
      momentIsDueForPushSweep(waiting, scheduledAt + MOMENT_PUSH_FALLBACK_MS),
    ).toBe(true);
  });

  it("does not select an already notified, trashed, insight, or just-me moment", () => {
    const now = floor + 60_000;
    expect(momentIsDueForPushSweep(candidate({ notifiedAt: now }), now)).toBe(
      false,
    );
    expect(momentIsDueForPushSweep(candidate({ trashed: true }), now)).toBe(
      false,
    );
    expect(momentIsDueForPushSweep(candidate({ kind: "insight" }), now)).toBe(
      false,
    );
    expect(
      momentIsDueForPushSweep(candidate({ audience: "just_me" }), now),
    ).toBe(false);
    expect(momentIsDueForPushSweep(candidate({ scheduledAt: null }), now)).toBe(
      false,
    );
  });

  it("ignores rows older than 24 hours even when they are after the cutoff", () => {
    const now = floor + 48 * 60 * 60 * 1000;
    expect(
      momentIsDueForPushSweep(
        candidate({ scheduledAt: now - 25 * 60 * 60 * 1000 }),
        now,
      ),
    ).toBe(false);
    expect(
      momentIsDueForPushSweep(
        candidate({ scheduledAt: now - 23 * 60 * 60 * 1000 }),
        now,
      ),
    ).toBe(true);
  });

  it("keeps the SQL sweep floor aligned with the app cutoff", () => {
    const migration = readFileSync(
      "supabase/migrations/20261005233000_moment_push_sweep.sql",
      "utf8",
    );
    expect(migration).toContain("timestamptz '2026-10-06 07:00:00+00'");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("interval '4 minutes'");
    expect(migration).toContain("claimed_rows integer");
  });
});
