import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  formatFindings,
  isBrowserDeliverableArtifact,
  scanFiles,
  scanRepository,
  scanText,
} from "../../scripts/private-artifact-scan.mjs";

const secretKey = ["sb", "secret", "contractfixture0123456789"].join("_");
const managementToken = ["sbp", "0123456789abcdef0123456789"].join("_");
const credentialedDatabaseUrl = [
  "postgresql",
  "://fixture:do-not-print@db.invalid:5432/family",
].join("");
const privateKey = [
  ["-----BEGIN", " PRIVATE KEY-----"].join(""),
  "ZmFrZS1idXQtbG9uZy1lbm91Z2gtY29udHJhY3QtZml4dHVyZQ==",
  ["-----END", " PRIVATE KEY-----"].join(""),
].join("\n");
const dsaPrivateKey = [
  ["-----BEGIN DSA", " PRIVATE KEY-----"].join(""),
  "ZmFrZS1idXQtbG9uZy1lbm91Z2gtZHNhLWNvbnRyYWN0LWZpeHR1cmU=",
  ["-----END DSA", " PRIVATE KEY-----"].join(""),
].join("\n");
const githubClassicToken = ["ghp", "A".repeat(40)].join("_");
const githubFineGrainedToken = [
  "github",
  "pat",
  "11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ",
].join("_");
const serviceRoleJwt = [
  Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
  Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"),
  "contractfixturesignature",
].join(".");

describe("private artifact scanner", () => {
  it.each([
    ["supabase-secret-key", secretKey],
    ["supabase-management-token", managementToken],
    ["credentialed-postgres-url", credentialedDatabaseUrl],
    ["private-key", privateKey],
    ["private-key", dsaPrivateKey],
    ["supabase-service-role-jwt", serviceRoleJwt],
    ["github-access-token", githubClassicToken],
    ["github-fine-grained-token", githubFineGrainedToken],
  ])("detects %s without returning the matching value", (ruleId, value) => {
    const findings = scanText({
      text: `prefix ${value} suffix`,
      path: "fixture.txt",
    });

    expect(findings).toEqual([
      expect.objectContaining({ ruleId, path: "fixture.txt", line: 1 }),
    ]);
    expect(JSON.stringify(findings)).not.toContain(value);
    expect(formatFindings(findings).join("\n")).not.toContain(value);
  });

  it("allows public Supabase keys and detector source text", () => {
    const text = [
      "sb_publishable_browser_safe_fixture",
      String.raw`/\\bsb_secret_[A-Za-z0-9._-]{16,}\\b/g`,
      "service_role",
      "postgresql://user@db.invalid/family",
    ].join("\n");

    expect(scanText({ text, path: "safe-source.ts" })).toEqual([]);
  });

  it("detects private fixture canaries only in browser-deliverable scope", () => {
    const text = String.raw`A visit to Sand Harbor \xb7 Lake Tahoe`;

    expect(
      scanText({ text, path: "server.js", checkPrivateClientData: false }),
    ).toEqual([]);
    expect(
      scanText({ text, path: "client.js", checkPrivateClientData: true }),
    ).toEqual([expect.objectContaining({ ruleId: "private-client-fixture" })]);
  });

  it("covers every named local design-fixture canary", () => {
    const text = [
      "Brian",
      "Molly",
      "Avery",
      "Sam",
      "June",
      "The small beach past the pine trees",
      "Sand Harbor",
      "All our days",
      "/sample-family.jpg",
      "The quiet ride home was my favorite part.",
      "I can still hear everyone laughing by the water.",
      "I wrote this down because I knew I would miss the noise.",
      "Those wet shoes stayed by the door for days.",
      "That brave wave still gets me.",
    ].join("\n");

    const findings = scanText({
      text,
      path: "browser.rsc",
      checkPrivateClientData: true,
    });
    expect(findings).toHaveLength(14);
    expect(
      findings.every(({ ruleId }) => ruleId === "private-client-fixture"),
    ).toBe(true);
  });

  it("does not mistake private names for substrings inside library code", () => {
    expect(
      scanText({
        text: "isSamePostgresFilter respectSamplingDecision",
        path: "client.js",
        checkPrivateClientData: true,
      }),
    ).toEqual([]);
  });

  it("reports line numbers and stable path order without exposing values", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-scan-"));
    writeFileSync(join(root, "z.txt"), `safe\n${secretKey}\n`);
    writeFileSync(join(root, "a.txt"), managementToken);

    expect(scanFiles({ root, paths: ["z.txt", "a.txt"] })).toEqual([
      {
        ruleId: "supabase-management-token",
        path: "a.txt",
        line: 1,
      },
      { ruleId: "supabase-secret-key", path: "z.txt", line: 2 },
    ]);
  });

  it("detects and redacts a credential present only in a filename", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-scan-"));
    const filename = `line\nleak-${secretKey}.txt`;
    writeFileSync(join(root, filename), "safe content");

    const findings = scanFiles({ root, paths: [filename] });
    const output = formatFindings(findings).join("\n");

    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings)).not.toContain(secretKey);
    expect(output).not.toContain(secretKey);
    expect(output).not.toContain("\nleak");
    expect(output).toContain("[redacted]");
    expect(output).toContain("[control]");
  });

  it("fails closed for symlink inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-scan-"));
    const outside = mkdtempSync(join(tmpdir(), "our-days-artifact-outside-"));
    writeFileSync(join(outside, "outside.txt"), "safe");
    symlinkSync(join(outside, "outside.txt"), join(root, "link.txt"));
    mkdirSync(join(root, "nested"));

    expect(scanFiles({ root, paths: ["link.txt"] })).toEqual([
      { ruleId: "unsafe-scan-path", path: "link.txt", line: 1 },
    ]);
  });

  it("rejects a symlinked build root before traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-repo-"));
    const outside = mkdtempSync(join(tmpdir(), "our-days-build-outside-"));
    writeFileSync(join(outside, "BUILD_ID"), "outside-build");
    symlinkSync(outside, join(root, ".next"));

    expect(() => scanRepository(root)).toThrow(
      "A completed production build (.next/BUILD_ID) is required.",
    );
  });

  it("includes untracked, non-ignored source in the credential scan", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-repo-"));
    mkdirSync(join(root, ".next"));
    writeFileSync(join(root, ".next", "BUILD_ID"), "fixture-build");
    writeFileSync(join(root, ".gitignore"), ".next\n");
    writeFileSync(join(root, "untracked.ts"), secretKey);
    expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);

    expect(scanRepository(root)).toEqual([
      expect.objectContaining({
        ruleId: "supabase-secret-key",
        path: "untracked.ts",
      }),
    ]);
  });

  it("scans the current worktree while tolerating an intentional tracked deletion", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-repo-"));
    mkdirSync(join(root, ".next"));
    writeFileSync(join(root, ".next", "BUILD_ID"), "fixture-build");
    writeFileSync(join(root, ".gitignore"), ".next\n");
    writeFileSync(join(root, "removed.ts"), "safe");
    expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
    expect(spawnSync("git", ["add", "removed.ts"], { cwd: root }).status).toBe(
      0,
    );
    unlinkSync(join(root, "removed.ts"));

    expect(scanRepository(root)).toEqual([]);
  });

  it.each([
    ["public/private.json", true],
    [".next/static/chunks/client.js", true],
    [".next/server/app/family.rsc", true],
    [".next/server/app/family.segment.rsc", true],
    [".next/server/app/family.html", true],
    [".next/server/app/robots.txt.body", true],
    [".next/server/app/family.meta", true],
    [".next/server/pages/family.json", true],
    [".next/server/pages-manifest.json", false],
    [".next/server/chunks/server.js", false],
    [".next/server/chunks/server.js.map", false],
    [".next/routes-manifest.json", false],
    [".next/standalone/app/public/private.json", true],
    [".next/standalone/app/.next/static/client.js", true],
  ])("classifies browser-deliverable path %s", (path, expected) => {
    expect(isBrowserDeliverableArtifact(path)).toBe(expected);
  });

  it("scans public, prerender, root-manifest, and standalone build surfaces", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-repo-"));
    const files = new Map([
      [".next/BUILD_ID", "fixture-build"],
      [".next/routes-manifest.json", secretKey],
      [".next/server/app/family.rsc", "Sand Harbor · Lake Tahoe"],
      [".next/server/app/family.meta", "Molly"],
      [
        ".next/standalone/app/.next/static/client.js",
        "The small beach past the pine trees",
      ],
      ["public/private.json", "Sand Harbor · Lake Tahoe"],
    ]);
    for (const [path, content] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
    expect(
      spawnSync("git", ["add", "--", "public/private.json"], { cwd: root })
        .status,
    ).toBe(0);

    expect(scanRepository(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "supabase-secret-key",
          path: ".next/routes-manifest.json",
        }),
        expect.objectContaining({
          ruleId: "private-client-fixture",
          path: ".next/server/app/family.rsc",
        }),
        expect.objectContaining({
          ruleId: "private-client-fixture",
          path: ".next/server/app/family.meta",
        }),
        expect.objectContaining({
          ruleId: "private-client-fixture",
          path: ".next/standalone/app/.next/static/client.js",
        }),
        expect.objectContaining({
          ruleId: "private-client-fixture",
          path: "public/private.json",
        }),
      ]),
    );
  });

  it("ignores disposable compiler cache while scanning deployable build output", () => {
    const root = mkdtempSync(join(tmpdir(), "our-days-artifact-repo-"));
    const files = new Map([
      [".next/BUILD_ID", "fixture-build"],
      [".next/cache/webpack/server-production/0.pack", secretKey],
      [".next/routes-manifest.json", "safe"],
    ]);
    for (const [path, content] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    writeFileSync(join(root, ".gitignore"), ".next\n");
    expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);

    expect(scanRepository(root)).toEqual([]);
  });

  it("keeps unexpected CLI filesystem errors generic", () => {
    const root = mkdtempSync(join(tmpdir(), `our-days-${secretKey}-`));
    const cli = resolve(process.cwd(), "scripts/verify-private-artifacts.mjs");
    const result = spawnSync(process.execPath, [cli], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(secretKey);
    expect(result.stderr).toContain("Private artifact scan could not run");
  });
});
