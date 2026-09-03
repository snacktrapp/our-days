import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const ci = readFileSync(
  resolve(process.cwd(), ".github/workflows/ci.yml"),
  "utf8",
);
const guard = readFileSync(
  resolve(process.cwd(), "scripts/verify-release-state.mjs"),
  "utf8",
);
const runbook = readFileSync(
  resolve(process.cwd(), "docs/operations/RELEASE_WORKFLOW.md"),
  "utf8",
);

describe("staging and release workflow", () => {
  it("runs the existing privacy-preserving CI gates on main and staging", () => {
    expect(ci).toContain("branches: [main, staging]");
    expect(ci).toContain("permissions:\n  contents: read");
    expect(ci).not.toContain("pull_request_target:");
  });

  it("rejects dirty, detached, and non-GitHub release sources", () => {
    expect(guard).toContain('"status", "--porcelain=v1"');
    expect(guard).toContain('new Set(["main", "staging"])');
    expect(guard).toContain('"remote", "get-url", "origin"');
    expect(guard).toContain("github\\.com");
    expect(packageJson.scripts["release:verify"]).toContain(
      "npm run release:state",
    );
  });

  it("binds Vercel Preview to the attached Our Days Supabase and requires an exact approved release", () => {
    expect(runbook).toContain(
      "Vercel Preview for this repository uses the Our Days Supabase already attached",
    );
    expect(runbook).toContain("point Preview at LiftSync, Proof");
    expect(runbook).toContain("exact Git commit");
    expect(runbook).toContain("staged Production Vercel deployment");
    expect(runbook).toContain("Supabase branches consume paid compute");
  });
});
