import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_REVIEW_DEMO_CIRCLE_ID } from "@/lib/app-review-demo-guard";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("app review demo seed source", () => {
  it("keeps the circle lookup on the stable marker and does not read an unscoped list", () => {
    const script = source("scripts/seed-app-review-demo.mjs");
    const sql = source(
      "supabase/migrations/20261004180000_app_review_demo_seed.sql",
    );

    expect(script).not.toContain("circles[0]");
    expect(script).not.toContain("Home");
    expect(script).toContain('.from("circles")');
    expect(script).toContain('.eq("id", APP_REVIEW_DEMO_CIRCLE_ID)');
    expect(script).not.toMatch(/from\("circles"\)[\s\S]{0,120}\.limit\(/);
    expect(script).not.toMatch(
      /from\("circle_memberships"\)[\s\S]{0,200}\.limit\(/,
    );
    expect(sql).toContain(APP_REVIEW_DEMO_CIRCLE_ID);
    expect(sql).not.toContain("Home");
    expect(sql).not.toContain("circles[0]");

    const unfilteredCircleReads = sql
      .replaceAll(
        "from public.circles as circle\n   where circle.id = demo_circle_id",
        "",
      )
      .replaceAll(
        "from public.circles as circle\n     where circle.id = demo_circle_id",
        "",
      );
    expect(unfilteredCircleReads).not.toContain("from public.circles");
  });
});
