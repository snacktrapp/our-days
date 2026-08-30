import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/ci.yml"),
  "utf8",
);
const checkoutAction =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNodeAction =
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";

function actionStepBlocks(action: string) {
  return workflow
    .split(/^      - name:/gm)
    .slice(1)
    .filter((block) => block.includes(`uses: ${action}`));
}

describe("CI workflow privacy and supply-chain contract", () => {
  it("uses immutable actions with read-only repository access", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow.match(/^permissions:[ \t]*$/gm)).toHaveLength(1);
    expect(workflow).not.toMatch(/^[ \t]+permissions:/gm);
    expect(workflow).not.toMatch(
      /^[ \t]*(?:permissions:[ \t]*write-all|[a-z-]+:[ \t]*write)[ \t]*$/gm,
    );
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).not.toContain("workflow_run:");
    expect(workflow.toLowerCase()).not.toContain("secrets");
    expect(workflow).toContain("OUR_DAYS_ENVIRONMENT: local");
    expect(workflow).toContain("OUR_DAYS_RESOURCE_MODE: detached");

    const actionReferences = [...workflow.matchAll(/uses:\s+(\S+)/g)].map(
      ([, reference]) => reference,
    );
    expect(actionReferences).toHaveLength(6);
    expect(new Set(actionReferences)).toEqual(
      new Set([checkoutAction, setupNodeAction]),
    );

    const checkoutSteps = actionStepBlocks(checkoutAction);
    expect(checkoutSteps).toHaveLength(3);
    for (const step of checkoutSteps) {
      expect(step).toContain("persist-credentials: false");
    }

    const setupNodeSteps = actionStepBlocks(setupNodeAction);
    expect(setupNodeSteps).toHaveLength(3);
    for (const step of setupNodeSteps) {
      expect(step).toContain("package-manager-cache: false");
    }
  });

  it("runs the required engines without exporting private browser artifacts", () => {
    expect(workflow).toContain(
      "playwright install --with-deps chromium firefox webkit",
    );
    expect(workflow).toContain("playwright test --grep-invert @visual");
    expect(workflow).toContain("runs-on: macos-15-intel");
    expect(workflow).toContain("--project=chromium-wide-visual");
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("download-artifact");
    expect(workflow).not.toContain("playwright-report/");
  });
});
