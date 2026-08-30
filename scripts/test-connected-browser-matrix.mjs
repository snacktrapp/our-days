import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const flow = fileURLToPath(
  new URL("./test-connected-browser-flow.mjs", import.meta.url),
);

for (const browserName of ["chromium", "firefox", "webkit"]) {
  process.stdout.write(`\nConnected browser gate: ${browserName}\n`);
  execFileSync(process.execPath, [flow], {
    cwd: projectRoot,
    env: { ...process.env, OUR_DAYS_CONNECTED_BROWSER: browserName },
    stdio: "inherit",
  });
}
