import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_SCANNED_FILE_BYTES = 64 * 1024 * 1024;

const credentialRules = [
  {
    id: "supabase-secret-key",
    pattern: /\bsb_secret_[A-Za-z0-9._-]{16,}\b/g,
  },
  {
    id: "supabase-management-token",
    pattern: /\bsbp_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "github-access-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  },
  {
    id: "github-fine-grained-token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
  },
  {
    id: "credentialed-postgres-url",
    pattern: /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^@\s/]+@[^/\s"'`]+/giu,
  },
  {
    id: "private-key",
    pattern: new RegExp(
      [
        "-{5}BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-{5}",
        "[\\s\\S]{32,}?",
        "-{5}END \\1-{5}",
      ].join(""),
      "g",
    ),
  },
];

const privateClientCanaries = [
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
];

const jwtCandidatePattern =
  /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{2,})\.([A-Za-z0-9_-]{2,})\.([A-Za-z0-9_-]{2,})(?![A-Za-z0-9_-])/g;

function posixPath(path) {
  return path.split(sep).join("/");
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function isServiceRoleJwt(candidate) {
  const [, payloadSegment] = candidate.split(".");
  try {
    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

export function redactSensitiveText(value) {
  let redacted = value;
  for (const rule of credentialRules) {
    rule.pattern.lastIndex = 0;
    redacted = redacted.replace(rule.pattern, "[redacted]");
  }
  jwtCandidatePattern.lastIndex = 0;
  redacted = redacted.replace(jwtCandidatePattern, (candidate) =>
    isServiceRoleJwt(candidate) ? "[redacted]" : candidate,
  );
  for (const canary of privateClientCanaries) {
    redacted = redacted.replaceAll(canary, "[redacted]");
  }
  return redacted.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "[control]");
}

function finding(ruleId, path, text, index) {
  return Object.freeze({
    ruleId,
    path: redactSensitiveText(posixPath(path)),
    line: lineNumberAt(text, index),
  });
}

function serviceRoleJwtFindings(text, path) {
  const findings = [];
  jwtCandidatePattern.lastIndex = 0;
  const candidates = text.matchAll(jwtCandidatePattern);

  for (const match of candidates) {
    if (isServiceRoleJwt(match[0])) {
      findings.push(
        finding("supabase-service-role-jwt", path, text, match.index),
      );
    }
  }

  return findings;
}

export function scanText({ text, path, checkPrivateClientData = false }) {
  const findings = [];

  for (const rule of credentialRules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push(finding(rule.id, path, text, match.index));
    }
  }

  findings.push(...serviceRoleJwtFindings(text, path));

  if (checkPrivateClientData) {
    for (const canary of privateClientCanaries) {
      let index = text.indexOf(canary);
      while (index !== -1) {
        findings.push(finding("private-client-fixture", path, text, index));
        index = text.indexOf(canary, index + canary.length);
      }
    }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

function safeFileWithin(root, path) {
  const rootRealPath = realpathSync(root);
  const pathRealPath = realpathSync(path);
  return (
    pathRealPath === rootRealPath ||
    pathRealPath.startsWith(`${rootRealPath}${sep}`)
  );
}

function scanFile(root, path, checkPrivateClientData) {
  const relativePath = posixPath(relative(root, path));
  const stat = lstatSync(path);
  const pathFindings = scanText({ text: relativePath, path: relativePath });

  if (stat.isSymbolicLink() || !safeFileWithin(root, path)) {
    return [
      ...pathFindings,
      Object.freeze({
        ruleId: "unsafe-scan-path",
        path: redactSensitiveText(relativePath),
        line: 1,
      }),
    ];
  }
  if (!stat.isFile()) {
    return [
      ...pathFindings,
      Object.freeze({
        ruleId: "unsafe-scan-path",
        path: redactSensitiveText(relativePath),
        line: 1,
      }),
    ];
  }
  if (stat.size > MAX_SCANNED_FILE_BYTES) {
    return [
      ...pathFindings,
      Object.freeze({
        ruleId: "unscanned-oversize-file",
        path: redactSensitiveText(relativePath),
        line: 1,
      }),
    ];
  }

  return [
    ...pathFindings,
    ...scanText({
      text: readFileSync(path).toString("utf8"),
      path: relativePath,
      checkPrivateClientData,
    }),
  ];
}

function walkFiles(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return [path];

  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = resolve(path, entry.name);
      return entry.isDirectory() ? walkFiles(child) : [child];
    });
}

export function scanFiles({ root, paths, checkPrivateClientData = false }) {
  const rootPath = resolve(root);
  return paths
    .map((path) => resolve(rootPath, path))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((path) => scanFile(rootPath, path, checkPrivateClientData))
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.line - right.line ||
        left.ruleId.localeCompare(right.ruleId),
    );
}

export function isBrowserDeliverableArtifact(path) {
  const normalizedPath = posixPath(path);
  if (
    normalizedPath === "public" ||
    normalizedPath.startsWith("public/") ||
    normalizedPath.includes("/public/") ||
    normalizedPath.startsWith(".next/static/") ||
    normalizedPath.includes("/.next/static/")
  ) {
    return true;
  }

  const isServerOutput =
    normalizedPath.startsWith(".next/server/") ||
    normalizedPath.includes("/.next/server/");
  const isPagesData =
    (normalizedPath.startsWith(".next/server/pages/") ||
      normalizedPath.includes("/.next/server/pages/")) &&
    normalizedPath.endsWith(".json");
  return (
    isPagesData ||
    (isServerOutput &&
      /\.(?:body|html|meta|rsc|txt|xml)$/u.test(normalizedPath))
  );
}

export function trackedFiles(root) {
  const presentResult = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const deletedResult = spawnSync("git", ["ls-files", "--deleted", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (presentResult.status !== 0 || deletedResult.status !== 0) {
    throw new Error("Could not enumerate tracked files for the privacy scan.");
  }
  const deletedPaths = new Set(
    deletedResult.stdout.split("\0").filter(Boolean),
  );
  return presentResult.stdout
    .split("\0")
    .filter((path) => path && !deletedPaths.has(path))
    .sort();
}

export function scanRepository(root) {
  const rootPath = resolve(root);
  const buildPath = resolve(rootPath, ".next");
  const buildIdPath = resolve(buildPath, "BUILD_ID");

  const buildStat = lstatSync(buildPath);
  const buildIdStat = lstatSync(buildIdPath);
  if (
    buildStat.isSymbolicLink() ||
    !buildStat.isDirectory() ||
    !safeFileWithin(rootPath, buildPath) ||
    buildIdStat.isSymbolicLink() ||
    !buildIdStat.isFile() ||
    !safeFileWithin(rootPath, buildIdPath)
  ) {
    throw new Error(
      "A completed production build (.next/BUILD_ID) is required.",
    );
  }

  const sourcePaths = trackedFiles(rootPath);
  const sourceFindings = scanFiles({
    root: rootPath,
    paths: sourcePaths,
  });
  const publicFindings = sourcePaths
    .filter((path) => isBrowserDeliverableArtifact(path))
    .flatMap((path) =>
      scanFile(rootPath, resolve(rootPath, path), true).filter(
        ({ ruleId }) => ruleId === "private-client-fixture",
      ),
    );
  const buildFindings = walkFiles(buildPath).flatMap((path) =>
    scanFile(
      rootPath,
      path,
      isBrowserDeliverableArtifact(relative(rootPath, path)),
    ),
  );

  return [...sourceFindings, ...publicFindings, ...buildFindings].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

export function formatFindings(findings) {
  return findings.map(
    ({ ruleId, path, line }) =>
      `- ${ruleId}: ${redactSensitiveText(path)}:${line} (value redacted)`,
  );
}
