#!/usr/bin/env node

import { formatFindings, scanRepository } from "./private-artifact-scan.mjs";

try {
  const findings = scanRepository(process.cwd());
  if (findings.length > 0) {
    console.error("Private artifact scan failed:");
    for (const message of formatFindings(findings)) console.error(message);
    process.exitCode = 1;
  } else {
    console.log(
      "Private artifact scan passed: tracked plus untracked non-ignored source and the complete production build contain no recognized privileged credentials; browser-deliverable artifacts contain no private design fixtures.",
    );
  }
} catch {
  console.error(
    "Private artifact scan could not run. Confirm this is a readable Git checkout with a completed production build.",
  );
  process.exitCode = 1;
}
