import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(root, "src");
const workerRoot = resolve(sourceRoot, "lib/invitation-worker");
const adapterNames = [
  "supabase-auth-admin-adapter",
  "supabase-coordinator-adapter",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe("invitation worker deployment isolation", () => {
  it("keeps privileged adapters out of the browser-neutral export surface", () => {
    const index = readFileSync(resolve(workerRoot, "index.ts"), "utf8");
    expect(index).toContain('export * from "./contract";');
    expect(index).toContain('export * from "./provisioner";');
    for (const adapterName of adapterNames) {
      expect(index).not.toContain(adapterName);
    }
  });

  it("keeps the Next application from importing worker-only adapters", () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => !path.startsWith(`${workerRoot}/`))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return adapterNames.some((adapterName) => source.includes(adapterName));
      })
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });

  it("keeps adapter activation and credentials outside source", () => {
    for (const adapterName of adapterNames) {
      const source = readFileSync(
        resolve(workerRoot, `${adapterName}.ts`),
        "utf8",
      );
      expect(source).not.toMatch(/process\.env|console\.|next\//u);
      expect(source).not.toMatch(
        /sb_secret_|service_role\s*[:=]|SUPABASE_SERVICE_ROLE/u,
      );
    }
  });
});
