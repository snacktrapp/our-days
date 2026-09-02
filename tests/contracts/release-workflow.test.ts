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
const pullRequestTemplate = readFileSync(
  resolve(process.cwd(), ".github/pull_request_template.md"),
  "utf8",
);

describe("preview and release workflow", () => {
  it("runs the privacy-preserving CI gate once on pull requests to main", () => {
    expect(ci).toContain("pull_request:\n    branches: [main]");
    expect(ci).toContain("workflow_dispatch:");
    expect(ci).not.toContain("  push:");
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

  it("keeps Preview detached and requires an exact approved release", () => {
    expect(runbook).toContain("Preview must never use the Production Supabase");
    expect(runbook).toContain("detached; design preview only");
    expect(runbook).toContain("exact commit approved");
    expect(runbook).toMatch(/promoting its build\s+artifact/u);
    expect(runbook).toContain("requires separate cost approval");
    expect(packageJson.scripts["verify:focused"]).toContain(
      "vitest run --changed origin/main",
    );
    expect(pullRequestTemplate).toContain("Preview deployment ID");
    expect(pullRequestTemplate).toContain("Brian approved this exact commit");
  });
});
