import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

const approvedBranches = new Set(["main", "staging"]);

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`Release state rejected: ${message}`);
  process.exitCode = 1;
}

let root;
try {
  root = realpathSync(git(["rev-parse", "--show-toplevel"]));
} catch {
  fail("run this command from the Our Days Git repository");
}

if (root && root !== realpathSync(process.cwd())) {
  fail(`run this command from the repository root (${root})`);
}

let branch;
try {
  branch = git(["branch", "--show-current"]);
} catch {
  fail("the current Git branch could not be resolved");
}
if (!branch || !approvedBranches.has(branch)) {
  fail(
    `the release branch must be one of: ${[...approvedBranches].join(", ")}`,
  );
}

let status;
try {
  status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
} catch {
  fail("the Git worktree state could not be read");
}
if (status) {
  fail("commit or intentionally discard every tracked and untracked change");
}

let origin;
try {
  origin = git(["remote", "get-url", "origin"]);
} catch {
  fail("an isolated GitHub origin is required before release verification");
}
if (
  origin &&
  !/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/u.test(origin) &&
  !/^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/u.test(origin)
) {
  fail("origin must be an isolated github.com repository");
}

let commit;
try {
  commit = git(["rev-parse", "--verify", "HEAD"]);
} catch {
  fail("the release must reference a committed Git revision");
}

if (!process.exitCode) {
  console.log(
    `Release state accepted: ${branch}@${commit.slice(0, 12)} from ${origin}`,
  );
}
