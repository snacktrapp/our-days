import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel source boundary", () => {
  it("excludes local credentials, Supabase state, and generated output", () => {
    const ignored = readFileSync(
      resolve(process.cwd(), ".vercelignore"),
      "utf8",
    );

    expect(ignored).toContain(".env*");
    expect(ignored).toContain("supabase/.temp/**");
    expect(ignored).toContain("supabase/.branches/**");
    expect(ignored).toContain(".next/**");
    expect(ignored).toContain("node_modules/**");
  });
});
