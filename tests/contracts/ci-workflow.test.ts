import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

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
    expect(actionReferences).toHaveLength(8);
    expect(new Set(actionReferences)).toEqual(
      new Set([checkoutAction, setupNodeAction]),
    );

    const checkoutSteps = actionStepBlocks(checkoutAction);
    expect(checkoutSteps).toHaveLength(4);
    for (const step of checkoutSteps) {
      expect(step).toContain("persist-credentials: false");
    }

    const setupNodeSteps = actionStepBlocks(setupNodeAction);
    expect(setupNodeSteps).toHaveLength(4);
    for (const step of setupNodeSteps) {
      expect(step).toContain("cache: npm");
    }
    expect(workflow).not.toContain("actions/cache@");
    expect(workflow).not.toContain("node_modules");
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
    const steps = workflow.split(/^      - name:/gm).slice(1);
    const buildStepIndexes = steps
      .map((step, index) =>
        /^\s*run: npm run build:webpack\s*$/m.test(step) ? index : -1,
      )
      .filter((index) => index !== -1);
    expect(buildStepIndexes).toHaveLength(3);
    expect(packageJson.scripts.build).toMatch(
      /^next build && npm run verify:artifacts$/,
    );
    expect(packageJson.scripts["build:webpack"]).toMatch(
      /^next build --webpack && npm run verify:artifacts$/,
    );
    for (const index of buildStepIndexes.slice(1)) {
      expect(steps[index + 1]).toContain("playwright test");
    }
  });

  it("runs the executable local authorization and schema-drift gates", () => {
    expect(workflow).toContain("run: npm run test:db");
    expect(workflow).toContain("run: npm run test:auth:integration");
    expect(workflow).toContain("run: npm run test:photo:integration");
    expect(workflow).toContain("run: npm run test:photo:concurrency");
    expect(workflow).toContain("run: npm run test:db:concurrency");
    expect(workflow).toContain("run: npm run types:db:check");
    expect(workflow).toContain("run: npm run test:browser:connected:all");
    expect(workflow).toContain(
      "playwright install --with-deps chromium firefox webkit",
    );
    expect(workflow).toContain("run: npm run db:lint");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("run: npm run supabase:stop");
    expect(workflow).not.toContain("needs:");
  });
});
