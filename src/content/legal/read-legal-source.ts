import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readPrivacyPolicySource() {
  return readFileSync(
    join(process.cwd(), "src/content/legal/privacy-policy.md"),
    "utf8",
  );
}

export function readTermsOfUseSource() {
  return readFileSync(
    join(process.cwd(), "src/content/legal/terms-of-use.md"),
    "utf8",
  );
}

export function readSupportPageSource() {
  return readFileSync(
    join(process.cwd(), "src/content/legal/support-page.md"),
    "utf8",
  );
}
