import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260903040000_moment_place_coordinates.sql",
  ),
  "utf8",
);

describe("moment place coordinates", () => {
  it("stores an optional WGS84 pin beside the existing place label", () => {
    expect(migration).toContain("add column latitude double precision");
    expect(migration).toContain("add column longitude double precision");
    expect(migration).toContain("moments_coordinates_valid");
    expect(migration).toContain("requested_latitude");
    expect(migration).toContain("requested_longitude");
    expect(migration).not.toMatch(/google|mapbox|postgis/iu);
  });
});
