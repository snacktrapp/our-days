import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const configPath = fileURLToPath(
  new URL("../supabase/config.toml", import.meta.url),
);
const linkedProjectRefPath = fileURLToPath(
  new URL("../supabase/.temp/project-ref", import.meta.url),
);
const legacyLinkedProjectRefPath = fileURLToPath(
  new URL("../.supabase/project-ref", import.meta.url),
);
const migrationsPath = fileURLToPath(
  new URL("../supabase/migrations", import.meta.url),
);
const projectId = "our-days";
const databaseContainer = `supabase_db_${projectId}`;
const lockPath = "/tmp/our-days-local-logical-restore.lock";
const processTimeoutMs = 120_000;
const maximumCapturedBytes = 64 * 1024 * 1024;
const schemaDumpRestrictKey = "OURDAYSLOCALRECOVERY20260830";
const reviewedSchemas = Object.freeze([
  "_realtime",
  "auth",
  "extensions",
  "graphql",
  "graphql_public",
  "pgbouncer",
  "private",
  "public",
  "realtime",
  "storage",
  "supabase_functions",
  "supabase_migrations",
  "vault",
]);
const expectedCanonicalSchemaFingerprint =
  "7b438caf3d92cf4e798f12754d19546197f8ef4f560a3854b7fd3ad86eda200b";
const expectedCanonicalCatalogFingerprint =
  "9ccc99a5b9bf6a959ae309b23a5279652e17d8d56ada5c090c4945b54760104e";
const expectedRestoredSchemaFingerprint =
  "2120b80bddc7e4d8c6bd4dcdbe2e60652c452f47212299702f29e8904480062e";
const expectedCanonicalDataFingerprint =
  "02aed07c454e54f35662be19f0b72f1c0792589a0d785c3c14cb4279f6b5ad10";
const expectedDatabaseMetadataFingerprint =
  "ee56a43f1de60f4e99b9dce508f52ccb0df623cc2f771b3215b08ddcdbfc4617";
const expectedDatabaseRepairSettingsFingerprint =
  "28b1448fc3b233f0155c8eb9d78d33b5a07dba55786d2b3e5de305cf0268784a";
const expectedArchiveInventoryFingerprint =
  "a654fc86e77ff4f90ede300ee071132e9bc312962e668bc5d08d6e06af380d82";
const expectedPrivateBuckets = Object.freeze([
  Object.freeze({
    allowed_mime_types: null,
    avif_autodetection: false,
    file_size_limit: 52_428_800,
    id: "our-days-display",
    name: "our-days-display",
    owner: null,
    owner_id: null,
    public: false,
    type: "STANDARD",
    versioning_status: "DISABLED",
  }),
  Object.freeze({
    allowed_mime_types: [
      "image/heic",
      "image/heif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ],
    avif_autodetection: false,
    file_size_limit: 52_428_800,
    id: "our-days-intake",
    name: "our-days-intake",
    owner: null,
    owner_id: null,
    public: false,
    type: "STANDARD",
    versioning_status: "DISABLED",
  }),
  Object.freeze({
    allowed_mime_types: null,
    avif_autodetection: false,
    file_size_limit: 52_428_800,
    id: "our-days-originals",
    name: "our-days-originals",
    owner: null,
    owner_id: null,
    public: false,
    type: "STANDARD",
    versioning_status: "DISABLED",
  }),
]);
const allowedProcessFailureCategories = new Set([
  "duplicate object",
  "extension",
  "other",
  "ownership",
  "role switch",
  "schema or database privilege",
  "session authorization",
]);
const volatileFixtureTimestampColumns = new Map([
  [
    "auth.users",
    new Set(["confirmed_at", "created_at", "email_confirmed_at", "updated_at"]),
  ],
  [
    "public.circle_memberships",
    new Set(["joined_at", "revoked_at", "updated_at"]),
  ],
  ["public.circles", new Set(["created_at", "updated_at"])],
  ["public.moment_notes", new Set(["created_at", "trashed_at", "updated_at"])],
  ["public.moment_people", new Set(["created_at", "removed_at"])],
  [
    "public.moment_reactions",
    new Set(["created_at", "removed_at", "updated_at"]),
  ],
  ["public.moments", new Set(["created_at", "trashed_at", "updated_at"])],
  ["public.people", new Set(["created_at", "updated_at"])],
  ["public.person_guardians", new Set(["created_at", "revoked_at"])],
  ["storage.buckets", new Set(["created_at", "updated_at"])],
  ["storage.migrations", new Set(["executed_at"])],
  ["supabase_functions.migrations", new Set(["inserted_at"])],
]);
const expectedMigrationFiles = [
  "20260830105244_phase_2_identity_authorization.sql",
  "20260830125653_phase_3_written_moments.sql",
  "20260830153119_phase_5_family_context.sql",
  "20260830173426_phase_6_memory_browsing.sql",
  "20260830201000_phase_6_milestone_browsing.sql",
  "20260830230000_phase_5_family_administration_hardening.sql",
  "20260830233000_phase_7_export_request_foundation.sql",
  "20260830234500_phase_2b_invitation_job_foundation.sql",
  "20260831000000_phase_7b_membership_attribution_foundation.sql",
  "20260831010000_phase_7c_account_closure_preparation.sql",
  "20260831020000_phase_4a_photo_intake_foundation.sql",
  "20260831030000_phase_2c_target_bound_invitation_materialization.sql",
];

class DrillError extends Error {
  constructor(stage) {
    super(stage);
    this.name = "DrillError";
    this.stage = stage;
  }
}

function classifyProcessFailure(diagnosticValue) {
  const diagnostic = diagnosticValue.toLowerCase();
  if (diagnostic.includes("session authorization")) {
    return "session authorization";
  }
  if (diagnostic.includes("set role") || diagnostic.includes("role")) {
    return "role switch";
  }
  if (
    diagnostic.includes("permission denied for schema") ||
    diagnostic.includes("permission denied for database")
  ) {
    return "schema or database privilege";
  }
  if (diagnostic.includes("owner") || diagnostic.includes("ownership")) {
    return "ownership";
  }
  if (diagnostic.includes("extension")) return "extension";
  if (
    diagnostic.includes("already exists") ||
    diagnostic.includes("duplicate")
  ) {
    return "duplicate object";
  }
  return "other";
}

let lockHeld = false;
let dumpCreated = false;
let restoreDatabaseCreated = false;
let interrupted = false;
let snapshotExporter = null;
let snapshotExporterBackendPid = null;
let snapshotExporterClosePromise = null;
let snapshotExporterErrorHandler = null;
let snapshotExporterErrorState = null;

const nonce = randomUUID().replaceAll("-", "");
const restoreDatabase = `our_days_restore_${nonce}`;
const dumpPath = `/tmp/our-days-restore-${nonce}.dump`;
const snapshotExporterApplicationName = `od_snapshot_${nonce}`;

function assertTemporaryTargets() {
  if (!/^our_days_restore_[0-9a-f]{32}$/.test(restoreDatabase)) {
    throw new DrillError("temporary target guard");
  }
  if (!/^\/tmp\/our-days-restore-[0-9a-f]{32}\.dump$/.test(dumpPath)) {
    throw new DrillError("temporary target guard");
  }
}

function runProcess(command, args, options = {}) {
  const captureFailure = Boolean(options.classifyFailure);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: options.capture || captureFailure ? "utf8" : undefined,
    input: options.input,
    maxBuffer: maximumCapturedBytes,
    stdio: options.capture
      ? [options.input === undefined ? "ignore" : "pipe", "pipe", "ignore"]
      : captureFailure
        ? ["ignore", "ignore", "pipe"]
        : "ignore",
    timeout: options.timeout ?? processTimeoutMs,
  });

  if (result.error || result.signal || result.status !== 0) {
    if (captureFailure) {
      const category = classifyProcessFailure(result.stderr ?? "");
      throw new DrillError(`${options.stage ?? "local process"} (${category})`);
    }
    throw new DrillError(options.stage ?? "local process");
  }
  return options.capture ? result.stdout : "";
}

function runDocker(args, options = {}) {
  return runProcess("docker", args, options);
}

function runDatabaseQuery(
  database,
  sql,
  stage,
  snapshot = null,
  username = "postgres",
) {
  const transactionSql = snapshot
    ? `begin isolation level repeatable read read only;\nset transaction snapshot '${snapshot}';\n${sql}\nrollback;\n`
    : sql;
  return runDocker(
    [
      "exec",
      "-i",
      databaseContainer,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      username,
      "--dbname",
      database,
    ],
    { capture: true, input: transactionSql, stage },
  );
}

function attachChildErrorRecorder(child, state) {
  const handler = () => {
    state.hadError = true;
  };
  child.on("error", handler);
  return handler;
}

async function startSnapshotExporter() {
  if (snapshotExporter || snapshotExporterClosePromise) {
    throw new DrillError("source snapshot lifecycle");
  }
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      databaseContainer,
      "psql",
      "-X",
      "-qAt",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
    ],
    {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  snapshotExporter = child;
  snapshotExporterErrorState = { hadError: false };
  snapshotExporterErrorHandler = attachChildErrorRecorder(
    child,
    snapshotExporterErrorState,
  );
  child.stdin.write(
    `set application_name = '${snapshotExporterApplicationName}';\nbegin isolation level serializable read only deferrable;\nselect pg_catalog.pg_export_snapshot() || '|' || pg_catalog.pg_backend_pid()::text;\n`,
  );

  const snapshot = await new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(
      () => reject(new DrillError("source snapshot")),
      30_000,
    );
    const fail = () => {
      clearTimeout(timeout);
      reject(new DrillError("source snapshot"));
    };
    child.once("error", fail);
    child.once("exit", fail);
    child.stdout.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timeout);
      child.removeListener("error", fail);
      child.removeListener("exit", fail);
      resolve(buffered.slice(0, newline).trim());
    });
  });

  const [snapshotId, backendPidText, ...unexpected] = snapshot.split("|");
  const backendPid = Number.parseInt(backendPidText, 10);
  if (
    unexpected.length !== 0 ||
    !/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshotId) ||
    !/^[1-9][0-9]{0,9}$/.test(backendPidText) ||
    !Number.isSafeInteger(backendPid)
  ) {
    throw new DrillError("source snapshot");
  }
  snapshotExporterBackendPid = backendPid;
  return snapshotId;
}

function waitForConfirmedChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      exited: true,
      signal: child.signalCode,
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("exit", handleExit);
      resolve(result);
    };
    const handleExit = (code, signal) => finish({ code, exited: true, signal });
    const timeout = setTimeout(
      () => finish({ code: null, exited: false, signal: null }),
      timeoutMs,
    );
    child.once("exit", handleExit);
  });
}

async function stopSnapshotExporterChild(
  child,
  {
    gracefulTimeoutMs = 10_000,
    killTimeoutMs = 5_000,
    termTimeoutMs = 5_000,
  } = {},
) {
  try {
    child.stdin.end("rollback;\n\\q\n");
  } catch {
    // Continue to bounded signal escalation and require a confirmed exit.
  }

  const graceful = await waitForConfirmedChildExit(child, gracefulTimeoutMs);
  if (graceful.exited) {
    return { clean: graceful.code === 0, confirmed: true };
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // Confirmation, not kill()'s return value, controls the result.
  }
  const terminated = await waitForConfirmedChildExit(child, termTimeoutMs);
  if (terminated.exited) return { clean: false, confirmed: true };

  try {
    child.kill("SIGKILL");
  } catch {
    // A failed signal still requires the final bounded exit confirmation.
  }
  const killed = await waitForConfirmedChildExit(child, killTimeoutMs);
  return { clean: false, confirmed: killed.exited };
}

function waitMilliseconds(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function assertSnapshotBackendIdentity(backendPid, applicationName) {
  if (
    !Number.isSafeInteger(backendPid) ||
    backendPid <= 0 ||
    !/^od_snapshot_[0-9a-f]{32}$/.test(applicationName)
  ) {
    throw new DrillError("source snapshot backend identity");
  }
}

function snapshotBackendIsAbsent(backendPid, applicationName) {
  assertSnapshotBackendIdentity(backendPid, applicationName);
  return (
    runDatabaseQuery(
      "postgres",
      `select (not exists (
  select 1
    from pg_catalog.pg_stat_activity as activity
   where activity.pid = ${backendPid}
     and activity.datname = 'postgres'
     and activity.application_name = '${applicationName}'
))::text;\n`,
      "source snapshot backend cleanup",
    ).trim() === "true"
  );
}

function terminateSnapshotBackend(backendPid, applicationName) {
  assertSnapshotBackendIdentity(backendPid, applicationName);
  return (
    runDatabaseQuery(
      "postgres",
      `select coalesce((
  select pg_catalog.pg_terminate_backend(activity.pid)
    from pg_catalog.pg_stat_activity as activity
   where activity.pid = ${backendPid}
     and activity.datname = 'postgres'
     and activity.application_name = '${applicationName}'
), true)::text;\n`,
      "source snapshot backend termination",
    ).trim() === "true"
  );
}

async function ensureSnapshotExporterBackendAbsent(
  backendPid,
  applicationName,
  {
    initialPollAttempts = 5,
    isAbsent = snapshotBackendIsAbsent,
    pollDelayMs = 100,
    terminateBackend = terminateSnapshotBackend,
    terminationPollAttempts = 10,
    wait = waitMilliseconds,
  } = {},
) {
  assertSnapshotBackendIdentity(backendPid, applicationName);
  for (let attempt = 0; attempt < initialPollAttempts; attempt += 1) {
    if (await isAbsent(backendPid, applicationName)) return true;
    await wait(pollDelayMs);
  }

  if (!(await terminateBackend(backendPid, applicationName))) return false;

  for (let attempt = 0; attempt < terminationPollAttempts; attempt += 1) {
    if (await isAbsent(backendPid, applicationName)) return true;
    await wait(pollDelayMs);
  }
  return false;
}

async function closeSnapshotExporter({
  stopOptions,
  verifyBackendAbsent = ensureSnapshotExporterBackendAbsent,
} = {}) {
  if (snapshotExporterClosePromise) return await snapshotExporterClosePromise;
  if (!snapshotExporter) return { absent: true, graceful: true };
  const child = snapshotExporter;
  const backendPid = snapshotExporterBackendPid;
  const applicationName = snapshotExporterApplicationName;
  const backendPidValid = Number.isSafeInteger(backendPid) && backendPid > 0;

  snapshotExporterClosePromise = (async () => {
    const result = await stopSnapshotExporterChild(child, stopOptions);
    const hadProcessError = snapshotExporterErrorState?.hadError === true;
    let backendAbsent = false;
    if (result.confirmed && backendPidValid) {
      try {
        backendAbsent = await verifyBackendAbsent(backendPid, applicationName);
      } catch {
        backendAbsent = false;
      }
    }
    if (result.confirmed && backendAbsent && snapshotExporter === child) {
      if (snapshotExporterErrorHandler) {
        child.removeListener("error", snapshotExporterErrorHandler);
      }
      snapshotExporter = null;
      snapshotExporterBackendPid = null;
      snapshotExporterErrorHandler = null;
      snapshotExporterErrorState = null;
    }
    return {
      absent: result.confirmed && backendAbsent,
      graceful:
        result.clean && result.confirmed && backendAbsent && !hadProcessError,
    };
  })();

  try {
    return await snapshotExporterClosePromise;
  } finally {
    snapshotExporterClosePromise = null;
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inventoryMatches(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function bucketInventoryMatches(actual) {
  return inventoryMatches(
    canonicalJson(actual),
    canonicalJson(expectedPrivateBuckets),
  );
}

function unsupportedDatabaseMetadataIsEmpty(comment, securityLabelCount) {
  return comment === null && securityLabelCount === 0;
}

function normalizeFixtureRow(identity, row) {
  const volatileColumns = volatileFixtureTimestampColumns.get(identity);
  if (!volatileColumns) return row;

  const normalized = { ...row };
  for (const column of volatileColumns) {
    if (!Object.hasOwn(normalized, column)) {
      throw new DrillError("volatile fixture normalization inventory");
    }
    normalized[column] = normalized[column] === null ? null : "<present>";
  }
  return normalized;
}

function readSchemaDumpFingerprint(database, snapshot = null) {
  const snapshotArgs = snapshot ? [`--snapshot=${snapshot}`] : [];
  const schemaDump = runDocker(
    [
      "exec",
      databaseContainer,
      "pg_dump",
      "--username",
      "postgres",
      "--dbname",
      database,
      "--no-password",
      "--schema-only",
      "--format=plain",
      `--restrict-key=${schemaDumpRestrictKey}`,
      ...snapshotArgs,
    ],
    {
      capture: true,
      stage: "complete schema archive fingerprint",
      timeout: 180_000,
    },
  );
  return hash(schemaDump);
}

function normalizeArchiveInventory(archiveList) {
  return archiveList
    .split("\n")
    .filter((line) => line && !line.startsWith(";"))
    .map((line) => line.replace(/^\d+; \d+ \d+ /, ""))
    .join("\n");
}

function acquireLock() {
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw new DrillError("exclusive lock");

    let priorPid;
    try {
      priorPid = Number.parseInt(readFileSync(lockPath, "utf8"), 10);
      process.kill(priorPid, 0);
      throw new DrillError("exclusive lock");
    } catch (lockError) {
      if (lockError instanceof DrillError) throw lockError;
      if (lockError?.code !== "ESRCH") throw new DrillError("exclusive lock");
      unlinkSync(lockPath);
      descriptor = openSync(lockPath, "wx", 0o600);
    }
  }

  writeFileSync(descriptor, `${process.pid}\n`, { encoding: "utf8" });
  closeSync(descriptor);
  lockHeld = true;
}

function retryCleanupOperation(operation, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (operation()) return true;
    } catch {
      // A cleanup retry is safer than exposing a command diagnostic that may
      // contain a live identifier. The final result remains a fixed category.
    }
  }
  return false;
}

function retainedCleanupFlag(current, operation) {
  return current && !retryCleanupOperation(operation);
}

function cleanup() {
  assertTemporaryTargets();

  if (restoreDatabaseCreated) {
    restoreDatabaseCreated = retainedCleanupFlag(true, () => {
      const dropResult = spawnSync(
        "docker",
        [
          "exec",
          databaseContainer,
          "dropdb",
          "--username",
          "postgres",
          "--maintenance-db",
          "postgres",
          "--if-exists",
          "--force",
          restoreDatabase,
        ],
        { cwd: projectRoot, stdio: "ignore", timeout: 30_000 },
      );
      if (dropResult.status !== 0) return false;
      const verifyResult = spawnSync(
        "docker",
        [
          "exec",
          databaseContainer,
          "psql",
          "-X",
          "-qAt",
          "--set",
          "ON_ERROR_STOP=1",
          "--username",
          "postgres",
          "--dbname",
          "postgres",
          "--command",
          `select (not exists (select 1 from pg_catalog.pg_database where datname = '${restoreDatabase}'))::text;`,
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 30_000,
        },
      );
      return verifyResult.status === 0 && verifyResult.stdout.trim() === "true";
    });
  }

  if (dumpCreated) {
    dumpCreated = retainedCleanupFlag(true, () => {
      const removeResult = spawnSync(
        "docker",
        ["exec", databaseContainer, "rm", "-f", "--", dumpPath],
        { cwd: projectRoot, stdio: "ignore", timeout: 30_000 },
      );
      if (removeResult.status !== 0) return false;
      const verifyResult = spawnSync(
        "docker",
        ["exec", databaseContainer, "test", "!", "-e", dumpPath],
        { cwd: projectRoot, stdio: "ignore", timeout: 30_000 },
      );
      return verifyResult.status === 0;
    });
  }

  if (lockHeld) {
    lockHeld = retainedCleanupFlag(true, () => {
      if (existsSync(lockPath)) unlinkSync(lockPath);
      return !existsSync(lockPath);
    });
  }

  return !restoreDatabaseCreated && !dumpCreated && !lockHeld;
}

async function handleSignal() {
  if (interrupted) return;
  interrupted = true;
  const snapshotResult = await closeSnapshotExporter();
  const clean = cleanup() && snapshotResult.absent;
  console.error(clean ? "FAIL: interrupted" : "FAIL: cleanup");
  process.exit(clean ? 130 : 1);
}

process.once("SIGINT", handleSignal);
process.once("SIGTERM", handleSignal);

const syntheticPreflightSql = String.raw`
select (
  not exists (
    select 1
      from auth.users
     where email is null
        or email !~* '^[^@[:space:]]+@example[.]test$'
  )
  and not exists (
    select 1
      from public.circles
     where id not in (
       '20000000-0000-4000-8000-000000000001'::uuid,
       '20000000-0000-4000-8000-000000000002'::uuid
     )
  )
  and not exists (select 1 from storage.objects)
)::text;
`;

const canonicalFixtureSql = String.raw`
select (
  (select count(*) = 7 from auth.users)
  and (select count(*) = 2 from public.circles)
  and (select count(*) = 9 from public.people)
  and (select count(*) = 7 from public.circle_memberships)
  and (select count(*) = 3 from public.person_guardians)
  and (select count(*) = 7 from public.moments)
  and (select count(*) = 1 from public.moment_people)
  and (select count(*) = 1 from public.moment_notes)
  and (select count(*) = 1 from public.moment_reactions)
  and (select count(*) = 0 from private.account_closure_memberships)
  and (select count(*) = 0 from private.account_closure_requests)
  and (select count(*) = 0 from private.invitations)
  and (select count(*) = 0 from private.audit_events)
  and (select count(*) = 0 from private.export_jobs)
  and (select count(*) = 0 from private.invitation_jobs)
  and (select count(*) = 0 from private.photo_intakes)
  and (select count(*) = 3 from storage.buckets)
  and (
    select count(*) = 2
      from storage.buckets
     where id in ('our-days-originals', 'our-days-display')
       and name = id
       and public is false
       and owner is null
       and owner_id is null
       and avif_autodetection is false
       and file_size_limit = 52428800
       and allowed_mime_types is null
       and type = 'STANDARD'
       and versioning_status = 'DISABLED'
  )
  and (
    select count(*) = 1
      from storage.buckets
     where id = 'our-days-intake'
       and name = id
       and public is false
       and owner is null
       and owner_id is null
       and avif_autodetection is false
       and file_size_limit = 52428800
       and allowed_mime_types = array[
         'image/heic',
         'image/heif',
         'image/jpeg',
         'image/png',
         'image/webp'
       ]::text[]
       and type = 'STANDARD'
       and versioning_status = 'DISABLED'
  )
  -- Logical database recovery preserves Storage metadata only. Any object row
  -- would imply unverified byte recovery and must fail this canonical drill.
  and not exists (select 1 from storage.objects)
  and not exists (select 1 from storage.buckets_analytics)
  and not exists (select 1 from storage.buckets_vectors)
  and not exists (select 1 from storage.iceberg_namespaces)
  and not exists (select 1 from storage.iceberg_tables)
  and not exists (select 1 from storage.s3_multipart_uploads)
  and not exists (select 1 from storage.s3_multipart_uploads_parts)
  and not exists (select 1 from storage.vector_indexes)
  and not exists (select 1 from auth.audit_log_entries)
  and not exists (select 1 from auth.custom_oauth_providers)
  and not exists (select 1 from auth.flow_state)
  and not exists (select 1 from auth.identities)
  and not exists (select 1 from auth.instances)
  and not exists (select 1 from auth.mfa_amr_claims)
  and not exists (select 1 from auth.mfa_challenges)
  and not exists (select 1 from auth.mfa_factors)
  and not exists (select 1 from auth.oauth_authorizations)
  and not exists (select 1 from auth.oauth_client_states)
  and not exists (select 1 from auth.oauth_clients)
  and not exists (select 1 from auth.oauth_consents)
  and not exists (select 1 from auth.one_time_tokens)
  and not exists (select 1 from auth.refresh_tokens)
  and not exists (select 1 from auth.saml_providers)
  and not exists (select 1 from auth.saml_relay_states)
  and not exists (select 1 from auth.sessions)
  and not exists (select 1 from auth.sso_domains)
  and not exists (select 1 from auth.sso_providers)
  and not exists (select 1 from auth.webauthn_challenges)
  and not exists (select 1 from auth.webauthn_credentials)
  and (
    select pg_catalog.array_agg(
      namespace.nspname || '.' || relation.relname
      order by namespace.nspname, relation.relname
    ) = array[
      'private.account_closure_memberships',
      'private.account_closure_requests',
      'private.audit_events',
      'private.export_jobs',
      'private.invitation_jobs',
      'private.invitations',
      'private.photo_intakes',
      'public.circle_memberships',
      'public.circles',
      'public.moment_notes',
      'public.moment_people',
      'public.moment_reactions',
      'public.moments',
      'public.people',
      'public.person_guardians'
    ]::text[]
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname in ('public', 'private')
       and relation.relkind in ('r', 'p')
  )
  and exists (
    select 1 from public.circles
     where id = '20000000-0000-4000-8000-000000000001'::uuid
  )
  and exists (
    select 1 from public.circles
     where id = '20000000-0000-4000-8000-000000000002'::uuid
  )
  and (
    select pg_catalog.array_agg(
      auth_user.id::text || '|' || auth_user.email
      order by auth_user.id
    ) = array[
      '10000000-0000-4000-8000-000000000001|organizer-one-a@example.test',
      '10000000-0000-4000-8000-000000000002|organizer-two-a@example.test',
      '10000000-0000-4000-8000-000000000003|member-a@example.test',
      '10000000-0000-4000-8000-000000000004|revoked-a@example.test',
      '10000000-0000-4000-8000-000000000005|dual-circle@example.test',
      '10000000-0000-4000-8000-000000000006|organizer-b@example.test',
      '10000000-0000-4000-8000-000000000007|no-circle@example.test'
    ]::text[]
      from auth.users as auth_user
     where auth_user.email_confirmed_at is not null
       and auth_user.confirmed_at = auth_user.email_confirmed_at
       and auth_user.instance_id is null
       and nullif(auth_user.aud, '') is null
       and nullif(auth_user.role, '') is null
       and nullif(auth_user.encrypted_password, '') is null
       and auth_user.invited_at is null
       and nullif(auth_user.confirmation_token, '') is null
       and auth_user.confirmation_sent_at is null
       and nullif(auth_user.recovery_token, '') is null
       and auth_user.recovery_sent_at is null
       and nullif(auth_user.email_change_token_new, '') is null
       and nullif(auth_user.email_change, '') is null
       and auth_user.email_change_sent_at is null
       and auth_user.last_sign_in_at is null
       and coalesce(auth_user.raw_app_meta_data, '{}'::jsonb) = '{}'::jsonb
       and coalesce(auth_user.raw_user_meta_data, '{}'::jsonb) = '{}'::jsonb
       and not coalesce(auth_user.is_super_admin, false)
       and nullif(auth_user.phone, '') is null
       and auth_user.phone_confirmed_at is null
       and nullif(auth_user.phone_change, '') is null
       and nullif(auth_user.phone_change_token, '') is null
       and auth_user.phone_change_sent_at is null
       and nullif(auth_user.email_change_token_current, '') is null
       and auth_user.email_change_confirm_status = 0
       and auth_user.banned_until is null
       and nullif(auth_user.reauthentication_token, '') is null
       and auth_user.reauthentication_sent_at is null
       and not coalesce(auth_user.is_sso_user, false)
       and auth_user.deleted_at is null
       and not coalesce(auth_user.is_anonymous, false)
  )
  and (
    select pg_catalog.array_agg(
      circle.id::text || '|' || circle.name || '|' || circle.time_zone
      order by circle.id
    ) = array[
      '20000000-0000-4000-8000-000000000001|Cedar Circle|America/Los_Angeles',
      '20000000-0000-4000-8000-000000000002|Harbor Circle|UTC'
    ]::text[]
      from public.circles as circle
  )
  and (
    select pg_catalog.array_agg(
      person.id::text || '|' || person.circle_id::text || '|'
        || person.display_name || '|' || person.profile_kind || '|'
        || person.accent_token
      order by person.id
    ) = array[
      '30000000-0000-4000-8000-000000000001|20000000-0000-4000-8000-000000000001|A Organizer One|account|clay',
      '30000000-0000-4000-8000-000000000002|20000000-0000-4000-8000-000000000001|A Organizer Two|account|sage',
      '30000000-0000-4000-8000-000000000003|20000000-0000-4000-8000-000000000001|A Member|account|gold',
      '30000000-0000-4000-8000-000000000004|20000000-0000-4000-8000-000000000001|A Revoked Member|account|sky',
      '30000000-0000-4000-8000-000000000005|20000000-0000-4000-8000-000000000001|A Dual Member|account|plum',
      '30000000-0000-4000-8000-000000000006|20000000-0000-4000-8000-000000000002|B Organizer|account|rose',
      '30000000-0000-4000-8000-000000000007|20000000-0000-4000-8000-000000000002|B Dual Organizer|account|plum',
      '30000000-0000-4000-8000-000000000008|20000000-0000-4000-8000-000000000001|A Managed Child|managed|sage',
      '30000000-0000-4000-8000-000000000009|20000000-0000-4000-8000-000000000002|B Managed Child|managed|gold'
    ]::text[]
      from public.people as person
  )
  and (
    select pg_catalog.array_agg(
      membership.id::text || '|' || membership.circle_id::text || '|'
        || membership.user_id::text || '|' || membership.person_id::text || '|'
        || membership.role || '|' || membership.status || '|'
        || (membership.revoked_at is not null)::text || '|'
        || coalesce(membership.revoked_by_membership_id::text, '')
      order by membership.id
    ) = array[
      '40000000-0000-4000-8000-000000000001|20000000-0000-4000-8000-000000000001|10000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000001|organizer|active|false|',
      '40000000-0000-4000-8000-000000000002|20000000-0000-4000-8000-000000000001|10000000-0000-4000-8000-000000000002|30000000-0000-4000-8000-000000000002|organizer|active|false|',
      '40000000-0000-4000-8000-000000000003|20000000-0000-4000-8000-000000000001|10000000-0000-4000-8000-000000000003|30000000-0000-4000-8000-000000000003|member|active|false|',
      '40000000-0000-4000-8000-000000000004|20000000-0000-4000-8000-000000000001|10000000-0000-4000-8000-000000000004|30000000-0000-4000-8000-000000000004|member|revoked|true|40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000005|20000000-0000-4000-8000-000000000001|10000000-0000-4000-8000-000000000005|30000000-0000-4000-8000-000000000005|member|active|false|',
      '40000000-0000-4000-8000-000000000006|20000000-0000-4000-8000-000000000002|10000000-0000-4000-8000-000000000006|30000000-0000-4000-8000-000000000006|organizer|active|false|',
      '40000000-0000-4000-8000-000000000007|20000000-0000-4000-8000-000000000002|10000000-0000-4000-8000-000000000005|30000000-0000-4000-8000-000000000007|organizer|active|false|'
    ]::text[]
      from public.circle_memberships as membership
  )
  and (
    select pg_catalog.array_agg(
      guardian.id::text || '|' || guardian.circle_id::text || '|'
        || guardian.managed_person_id::text || '|'
        || guardian.guardian_membership_id::text || '|'
        || guardian.created_by_membership_id::text
      order by guardian.id
    ) = array[
      '50000000-0000-4000-8000-000000000001|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000008|40000000-0000-4000-8000-000000000001|40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000008|40000000-0000-4000-8000-000000000002|40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000003|20000000-0000-4000-8000-000000000002|30000000-0000-4000-8000-000000000009|40000000-0000-4000-8000-000000000006|40000000-0000-4000-8000-000000000006'
    ]::text[]
      from public.person_guardians as guardian
  )
  and (
    select pg_catalog.array_agg(
      moment.id::text || '|' || moment.circle_id::text || '|'
        || moment.journal_person_id::text || '|'
        || moment.recorded_by_membership_id::text || '|' || moment.kind || '|'
        || coalesce(moment.title, '') || '|' || coalesce(moment.body, '') || '|'
        || coalesce(moment.place_name, '') || '|' || moment.occurred_on::text || '|'
        || coalesce(moment.occurred_at::text, '') || '|'
        || coalesce(moment.occurred_timezone, '') || '|' || moment.time_precision || '|'
        || (moment.trashed_at is not null)::text || '|'
        || coalesce(moment.trashed_by_membership_id::text, '')
      order by moment.id
    ) = array[
      '60000000-0000-4000-8000-000000000001|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000001|40000000-0000-4000-8000-000000000001|thought||A small ordinary morning worth keeping.||2026-08-28|||date|false|',
      '60000000-0000-4000-8000-000000000002|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000008|40000000-0000-4000-8000-000000000001|thought||A managed child found a new favorite word.||2026-08-27|2026-08-27 17:15:00+00|America/Los_Angeles|minute|false|',
      '60000000-0000-4000-8000-000000000003|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000002|40000000-0000-4000-8000-000000000002|location||The late light reached all the way across the kitchen.|Home kitchen|2026-08-27|2026-08-27 17:15:00+00|America/Los_Angeles|minute|false|',
      '60000000-0000-4000-8000-000000000004|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000003|40000000-0000-4000-8000-000000000003|thought||An older page added on the day it really happened.||2021-04-03|||date|false|',
      '60000000-0000-4000-8000-000000000005|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000001|40000000-0000-4000-8000-000000000001|thought||A reversible discarded draft.||2026-08-20|||date|true|40000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000006|20000000-0000-4000-8000-000000000002|30000000-0000-4000-8000-000000000006|40000000-0000-4000-8000-000000000006|thought||A harbor-circle moment stays in its own family.||2026-08-28|||date|false|',
      '60000000-0000-4000-8000-000000000007|20000000-0000-4000-8000-000000000001|30000000-0000-4000-8000-000000000003|40000000-0000-4000-8000-000000000003|milestone|A new favorite word|A family phrase worth carrying forward.||2020-03-14|||date|false|'
    ]::text[]
      from public.moments as moment
  )
  and (
    select pg_catalog.array_agg(
      tagged.moment_id::text || '|' || tagged.person_id::text || '|'
        || tagged.tagged_by_membership_id::text
      order by tagged.moment_id, tagged.person_id
    ) = array[
      '60000000-0000-4000-8000-000000000007|30000000-0000-4000-8000-000000000002|40000000-0000-4000-8000-000000000001'
    ]::text[]
      from public.moment_people as tagged
  )
  and (
    select pg_catalog.array_agg(
      note.id::text || '|' || note.moment_id::text || '|'
        || note.author_membership_id::text || '|' || note.body
      order by note.id
    ) = array[
      '70000000-0000-4000-8000-000000000001|60000000-0000-4000-8000-000000000007|40000000-0000-4000-8000-000000000002|The delighted laugh afterward is worth remembering.'
    ]::text[]
      from public.moment_notes as note
  )
  and (
    select pg_catalog.array_agg(
      reaction.id::text || '|' || reaction.moment_id::text || '|'
        || reaction.author_membership_id::text || '|' || reaction.reaction_type
      order by reaction.id
    ) = array[
      '80000000-0000-4000-8000-000000000001|60000000-0000-4000-8000-000000000007|40000000-0000-4000-8000-000000000002|held-close'
    ]::text[]
      from public.moment_reactions as reaction
  )
  and (
    select pg_catalog.array_agg(history.version::text order by history.version::text)
      = array[
        '20260830105244',
        '20260830125653',
        '20260830153119',
        '20260830173426',
        '20260830201000',
        '20260830230000',
        '20260830233000',
        '20260830234500',
        '20260831000000',
        '20260831010000',
        '20260831020000',
        '20260831030000'
      ]::text[]
      from supabase_migrations.schema_migrations as history
  )
)::text;
`;

const catalogManifestSql = String.raw`
with selected_namespaces as (
  select oid, nspname, nspowner, nspacl
    from pg_catalog.pg_namespace
   where nspname in (
     '_realtime', 'auth', 'extensions', 'graphql', 'graphql_public',
     'pgbouncer', 'private', 'public', 'realtime', 'storage',
     'supabase_functions', 'supabase_migrations', 'vault'
   )
),
items as (
  select
    'schema'::text as category,
    namespace.nspname::text as identity,
    concat_ws('|',
      pg_catalog.pg_get_userbyid(namespace.nspowner),
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(namespace.nspacl) as acl_entry
         where acl_entry.grantee <> namespace.nspowner
      ), '[]')
    ) as definition
  from selected_namespaces as namespace

  union all

  select
    'relation',
    namespace.nspname || '.' || relation.relname,
    concat_ws('|',
      relation.relkind::text,
      relation.relpersistence::text,
      pg_catalog.pg_get_userbyid(relation.relowner),
      relation.relrowsecurity::text,
      relation.relforcerowsecurity::text,
      relation.relreplident::text,
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(relation.relacl) as acl_entry
         where acl_entry.grantee <> relation.relowner
      ), '[]'),
      coalesce(relation.reloptions::text, '<null>'),
      coalesce(pg_catalog.pg_get_viewdef(relation.oid, true), '<not-view>'),
      coalesce(pg_catalog.obj_description(relation.oid, 'pg_class'), '<null>')
    )
  from pg_catalog.pg_class as relation
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  where relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')

  union all

  select
    'column',
    namespace.nspname || '.' || relation.relname || '.' || attribute.attname,
    concat_ws('|',
      -- Logical dumps preserve live-column order, not physical holes left by
      -- dropped columns, so compare the live ordinal rather than attnum.
      pg_catalog.row_number() over (
        partition by relation.oid order by attribute.attnum
      )::text,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull::text,
      attribute.attidentity::text,
      attribute.attgenerated::text,
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(attribute.attacl) as acl_entry
         where acl_entry.grantee <> relation.relowner
      ), '[]'),
      coalesce(pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), '<null>'),
      coalesce(pg_catalog.col_description(relation.oid, attribute.attnum), '<null>')
    )
  from pg_catalog.pg_attribute as attribute
  join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  left join pg_catalog.pg_attrdef as default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attnum > 0
    and not attribute.attisdropped
    and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')

  union all

  select
    'constraint',
    namespace.nspname || '.' || relation.relname || '.' || constraint_row.conname,
    concat_ws('|',
      constraint_row.contype::text,
      constraint_row.condeferrable::text,
      constraint_row.condeferred::text,
      constraint_row.convalidated::text,
      pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    )
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as relation on relation.oid = constraint_row.conrelid
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace

  union all

  select
    'index',
    namespace.nspname || '.' || index_relation.relname,
    concat_ws('|',
      index_row.indisunique::text,
      index_row.indisprimary::text,
      index_row.indisvalid::text,
      index_row.indisready::text,
      pg_catalog.pg_get_indexdef(index_row.indexrelid)
    )
  from pg_catalog.pg_index as index_row
  join pg_catalog.pg_class as index_relation on index_relation.oid = index_row.indexrelid
  join selected_namespaces as namespace on namespace.oid = index_relation.relnamespace

  union all

  select
    'policy',
    namespace.nspname || '.' || relation.relname || '.' || policy.polname,
    concat_ws('|',
      policy.polcmd::text,
      policy.polpermissive::text,
      coalesce((
        select pg_catalog.string_agg(role_row.rolname, ',' order by role_row.rolname)
          from pg_catalog.pg_roles as role_row
         where role_row.oid = any(policy.polroles)
      ), '<public>'),
      coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '<null>'),
      coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '<null>')
    )
  from pg_catalog.pg_policy as policy
  join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace

  union all

  select
    'function',
    namespace.nspname || '.' || routine.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(routine.oid) || ')',
    concat_ws('|',
      routine.prokind::text,
      routine.prosecdef::text,
      routine.proleakproof::text,
      routine.provolatile::text,
      routine.proparallel::text,
      pg_catalog.pg_get_userbyid(routine.proowner),
      pg_catalog.pg_get_function_result(routine.oid),
      coalesce(routine.proconfig::text, '<null>'),
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(routine.proacl) as acl_entry
         where acl_entry.grantee <> routine.proowner
      ), '[]'),
      pg_catalog.pg_get_functiondef(routine.oid),
      coalesce(pg_catalog.obj_description(routine.oid, 'pg_proc'), '<null>')
    )
  from pg_catalog.pg_proc as routine
  join selected_namespaces as namespace on namespace.oid = routine.pronamespace

  union all

  select
    'trigger',
    namespace.nspname || '.' || relation.relname || '.' || trigger_row.tgname,
    concat_ws('|',
      trigger_row.tgenabled::text,
      pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
    )
  from pg_catalog.pg_trigger as trigger_row
  join pg_catalog.pg_class as relation on relation.oid = trigger_row.tgrelid
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  where not trigger_row.tgisinternal

  union all

  select
    'type',
    namespace.nspname || '.' || type_row.typname,
    concat_ws('|',
      type_row.typtype::text,
      pg_catalog.pg_get_userbyid(type_row.typowner),
      type_row.typnotnull::text,
      coalesce(pg_catalog.format_type(type_row.typbasetype, type_row.typtypmod), '<null>'),
      coalesce(type_row.typdefault, '<null>'),
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(type_row.typacl) as acl_entry
         where acl_entry.grantee <> type_row.typowner
      ), '[]'),
      coalesce((
        select pg_catalog.string_agg(enum_row.enumlabel, ',' order by enum_row.enumsortorder)
          from pg_catalog.pg_enum as enum_row
         where enum_row.enumtypid = type_row.oid
      ), '<null>')
    )
  from pg_catalog.pg_type as type_row
  join selected_namespaces as namespace on namespace.oid = type_row.typnamespace
  where type_row.typtype in ('d', 'e', 'r', 'm')

  union all

  select
    'default-acl',
    pg_catalog.pg_get_userbyid(default_acl.defaclrole) || '.'
      || coalesce(namespace.nspname, '<global>') || '.'
      || default_acl.defaclobjtype::text,
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          case when acl_entry.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
          acl_entry.privilege_type,
          acl_entry.is_grantable
        )
        order by
          case when acl_entry.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
          acl_entry.privilege_type,
          acl_entry.is_grantable
      )::text
        from pg_catalog.aclexplode(default_acl.defaclacl) as acl_entry
       where acl_entry.grantee <> default_acl.defaclrole
    ), '[]')
  from pg_catalog.pg_default_acl as default_acl
  left join pg_catalog.pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
  where (
    default_acl.defaclnamespace = 0
    or default_acl.defaclnamespace in (select oid from selected_namespaces)
  )
    and exists (
      select 1
        from pg_catalog.aclexplode(default_acl.defaclacl) as acl_entry
       where acl_entry.grantee <> default_acl.defaclrole
    )

  union all

  select
    'extension',
    extension.extname,
    concat_ws('|', namespace.nspname, extension.extversion, extension.extrelocatable::text)
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace

  union all

  select
    'sequence-state',
    sequence_row.schemaname || '.' || sequence_row.sequencename,
    concat_ws('|',
      sequence_row.sequenceowner,
      sequence_row.data_type,
      sequence_row.start_value::text,
      sequence_row.min_value::text,
      sequence_row.max_value::text,
      sequence_row.increment_by::text,
      sequence_row.cycle::text,
      sequence_row.cache_size::text,
      coalesce(sequence_row.last_value::text, '<null>')
    )
  from pg_catalog.pg_sequences as sequence_row
  where sequence_row.schemaname in (
    '_realtime', 'auth', 'extensions', 'graphql', 'graphql_public',
    'pgbouncer', 'private', 'public', 'realtime', 'storage',
    'supabase_functions', 'supabase_migrations', 'vault'
  )
)
select pg_catalog.jsonb_build_array(category, identity, definition)::text
  from items
 order by category, identity, definition;
`;

const dataTableListSql = String.raw`
select namespace.nspname || E'\x1f' || relation.relname
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
 where namespace.nspname in (
   '_realtime', 'auth', 'extensions', 'graphql', 'graphql_public',
   'pgbouncer', 'private', 'public', 'realtime', 'storage',
   'supabase_functions', 'supabase_migrations', 'vault'
 )
   and relation.relkind in ('r', 'p', 'm')
 order by namespace.nspname, relation.relname;
`;

const catalogFieldDiagnosticSql = String.raw`
with selected_namespaces as (
  select oid, nspname
    from pg_catalog.pg_namespace
   where nspname in (
     '_realtime', 'auth', 'extensions', 'graphql', 'graphql_public',
     'pgbouncer', 'private', 'public', 'realtime', 'storage',
     'supabase_functions', 'supabase_migrations', 'vault'
   )
),
relation_fields as (
  select
    'relation'::text as category,
    namespace.nspname || '.' || relation.relname as identity,
    pg_catalog.jsonb_build_object(
      'acl', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(relation.relacl) as acl_entry
         where acl_entry.grantee <> relation.relowner
      ), '[]'),
      'comment', coalesce(pg_catalog.obj_description(relation.oid, 'pg_class'), '<null>'),
      'force_rls', relation.relforcerowsecurity::text,
      'kind', relation.relkind::text,
      'options', coalesce(relation.reloptions::text, '<null>'),
      'owner', pg_catalog.pg_get_userbyid(relation.relowner),
      'persistence', relation.relpersistence::text,
      'replica_identity', relation.relreplident::text,
      'rls', relation.relrowsecurity::text,
      'view', coalesce(pg_catalog.pg_get_viewdef(relation.oid, true), '<not-view>')
    ) as fields
  from pg_catalog.pg_class as relation
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  where relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
),
column_fields as (
  select
    'column'::text as category,
    namespace.nspname || '.' || relation.relname || '.' || attribute.attname as identity,
    pg_catalog.jsonb_build_object(
      'acl', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )::text
          from pg_catalog.aclexplode(attribute.attacl) as acl_entry
         where acl_entry.grantee <> relation.relowner
      ), '[]'),
      'comment', coalesce(pg_catalog.col_description(relation.oid, attribute.attnum), '<null>'),
      'default', coalesce(
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
        '<null>'
      ),
      'generated', attribute.attgenerated::text,
      'identity', attribute.attidentity::text,
      'not_null', attribute.attnotnull::text,
      -- Logical dumps preserve live-column order, not physical holes left by
      -- dropped columns, so compare the live ordinal rather than attnum.
      'position', pg_catalog.row_number() over (
        partition by relation.oid order by attribute.attnum
      )::text,
      'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    ) as fields
  from pg_catalog.pg_attribute as attribute
  join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  left join pg_catalog.pg_attrdef as default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attnum > 0
    and not attribute.attisdropped
    and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
),
field_rows as (
  select category, identity, field.key as field, field.value
    from relation_fields
    cross join lateral pg_catalog.jsonb_each(relation_fields.fields) as field
  union all
  select category, identity, field.key as field, field.value
    from column_fields
    cross join lateral pg_catalog.jsonb_each(column_fields.fields) as field
)
select pg_catalog.jsonb_build_array(category, identity, field, value)::text
  from field_rows
 order by category, identity, field;
`;

const aclProvenanceManifestSql = String.raw`
with selected_namespaces as (
  select oid, nspname, nspowner, nspacl
    from pg_catalog.pg_namespace
   where nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')
),
acl_sources as (
  select
    'schema'::text as category,
    namespace.nspname::text as identity,
    pg_catalog.pg_get_userbyid(namespace.nspowner) as owner_context,
    namespace.nspacl as acl
  from selected_namespaces as namespace

  union all

  select
    'relation',
    namespace.nspname || '.' || relation.relname,
    pg_catalog.pg_get_userbyid(relation.relowner),
    relation.relacl
  from pg_catalog.pg_class as relation
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  where relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')

  union all

  select
    'column',
    namespace.nspname || '.' || relation.relname || '.' || attribute.attname,
    pg_catalog.pg_get_userbyid(relation.relowner),
    attribute.attacl
  from pg_catalog.pg_attribute as attribute
  join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
  join selected_namespaces as namespace on namespace.oid = relation.relnamespace
  where attribute.attnum > 0
    and not attribute.attisdropped
    and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')

  union all

  select
    'function',
    namespace.nspname || '.' || routine.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(routine.oid) || ')',
    pg_catalog.pg_get_userbyid(routine.proowner),
    routine.proacl
  from pg_catalog.pg_proc as routine
  join selected_namespaces as namespace on namespace.oid = routine.pronamespace

  union all

  select
    'type',
    namespace.nspname || '.' || type_row.typname,
    pg_catalog.pg_get_userbyid(type_row.typowner),
    type_row.typacl
  from pg_catalog.pg_type as type_row
  join selected_namespaces as namespace on namespace.oid = type_row.typnamespace
  where type_row.typtype in ('d', 'e', 'r', 'm')

  union all

  select
    'default-acl',
    pg_catalog.pg_get_userbyid(default_acl.defaclrole) || '.'
      || coalesce(namespace.nspname, '<global>') || '.'
      || default_acl.defaclobjtype::text,
    pg_catalog.pg_get_userbyid(default_acl.defaclrole),
    default_acl.defaclacl
  from pg_catalog.pg_default_acl as default_acl
  left join pg_catalog.pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
  where default_acl.defaclnamespace = 0
     or default_acl.defaclnamespace in (select oid from selected_namespaces)
)
select pg_catalog.jsonb_build_array(
  source.category,
  source.identity,
  source.owner_context,
  case when acl_entry.grantee = 0 then 'PUBLIC'
    else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
  pg_catalog.pg_get_userbyid(acl_entry.grantor),
  acl_entry.privilege_type,
  acl_entry.is_grantable
)::text
  from acl_sources as source
  cross join lateral pg_catalog.aclexplode(source.acl) as acl_entry
 order by
   source.category,
   source.identity,
   source.owner_context,
   case when acl_entry.grantee = 0 then 'PUBLIC'
     else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
   pg_catalog.pg_get_userbyid(acl_entry.grantor),
   acl_entry.privilege_type,
   acl_entry.is_grantable;
`;

const reviewedRelationAclStateSql = String.raw`
select pg_catalog.jsonb_build_array(
  namespace.nspname || '.' || relation.relname,
  pg_catalog.pg_get_userbyid(relation.relowner),
  relation.relacl is null
)::text
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
 where namespace.nspname = 'private'
   and relation.relname in (
     'account_closure_memberships',
     'account_closure_requests',
     'audit_events',
     'audit_events_id_seq',
     'export_jobs',
     'invitation_jobs',
     'invitations',
     'photo_intakes'
   )
 order by relation.relname;
`;

const migrationHistorySql = String.raw`
select to_jsonb(history)::text
  from supabase_migrations.schema_migrations as history
 order by to_jsonb(history)::text;
`;

const reviewedSchemaInventorySql = String.raw`
select namespace.nspname
  from pg_catalog.pg_namespace as namespace
 where namespace.nspname <> 'information_schema'
   and namespace.nspname !~ '^pg_'
 order by namespace.nspname;
`;

const privateBucketInventorySql = String.raw`
select (
  to_jsonb(bucket)
    - 'created_at'
    - 'updated_at'
)::text
  from storage.buckets as bucket
 order by bucket.id;
`;

const databaseMetadataSql = String.raw`
with metadata as (
  select
    'database'::text as category,
    'settings'::text as label,
    pg_catalog.jsonb_build_object(
      'acl', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            pg_catalog.pg_get_userbyid(acl_entry.grantor),
            acl_entry.privilege_type,
            acl_entry.is_grantable
          )
          order by
            case when acl_entry.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_entry.grantee) end,
            acl_entry.privilege_type,
            acl_entry.is_grantable
        )
          from pg_catalog.aclexplode(database_row.datacl) as acl_entry
      ), '[]'::pg_catalog.jsonb),
      'allow_connections', database_row.datallowconn,
      'collation', database_row.datcollate,
      'connection_limit', database_row.datconnlimit,
      'ctype', database_row.datctype,
      'encoding', pg_catalog.pg_encoding_to_char(database_row.encoding),
      'locale', database_row.datlocale,
      'icu_rules', database_row.daticurules,
      'locale_provider', database_row.datlocprovider,
      'owner', pg_catalog.pg_get_userbyid(database_row.datdba)
    ) as value
  from pg_catalog.pg_database as database_row
  where database_row.datname = current_database()

  union all

  select
    'database-role-setting',
    coalesce(role_row.rolname, '<all>'),
    coalesce((
      select pg_catalog.jsonb_agg(setting_value order by setting_value)
        from pg_catalog.unnest(setting_row.setconfig) as setting_value
    ), '[]'::pg_catalog.jsonb)
  from pg_catalog.pg_db_role_setting as setting_row
  left join pg_catalog.pg_roles as role_row on role_row.oid = setting_row.setrole
  where setting_row.setdatabase = (select oid from pg_catalog.pg_database where datname = current_database())

  union all

  select
    'event-trigger',
    event_trigger.evtname,
    pg_catalog.jsonb_build_object(
      'enabled', event_trigger.evtenabled,
      'event', event_trigger.evtevent,
      'function', event_trigger.evtfoid::pg_catalog.regprocedure::text,
      'owner', pg_catalog.pg_get_userbyid(routine.proowner),
      'tags', event_trigger.evttags
    )
  from pg_catalog.pg_event_trigger as event_trigger
  join pg_catalog.pg_proc as routine on routine.oid = event_trigger.evtfoid

  union all

  select
    'publication',
    publication.pubname,
    pg_catalog.jsonb_build_object(
      'all_tables', publication.puballtables,
      'delete', publication.pubdelete,
      'insert', publication.pubinsert,
      'owner', pg_catalog.pg_get_userbyid(publication.pubowner),
      'truncate', publication.pubtruncate,
      'update', publication.pubupdate,
      'via_partition_root', publication.pubviaroot
    )
  from pg_catalog.pg_publication as publication

  union all

  select
    'publication-schema',
    publication.pubname,
    to_jsonb(namespace.nspname)
  from pg_catalog.pg_publication_namespace as published_namespace
  join pg_catalog.pg_publication as publication on publication.oid = published_namespace.pnpubid
  join pg_catalog.pg_namespace as namespace on namespace.oid = published_namespace.pnnspid

  union all

  select
    'publication-relation',
    publication.pubname,
    pg_catalog.jsonb_build_object(
      'columns', published_relation.prattrs,
      'qualifier', coalesce(
        pg_catalog.pg_get_expr(published_relation.prqual, published_relation.prrelid),
        '<null>'
      ),
      'relation', published_relation.prrelid::pg_catalog.regclass::text
    )
  from pg_catalog.pg_publication_rel as published_relation
  join pg_catalog.pg_publication as publication on publication.oid = published_relation.prpubid

  union all

  select
    'subscription',
    subscription.subname,
    pg_catalog.jsonb_build_object(
      'binary', subscription.subbinary,
      'conninfo', subscription.subconninfo,
      'disable_on_error', subscription.subdisableonerr,
      'enabled', subscription.subenabled,
      'failover', subscription.subfailover,
      'origin', subscription.suborigin,
      'owner', pg_catalog.pg_get_userbyid(subscription.subowner),
      'password_required', subscription.subpasswordrequired,
      'publications', subscription.subpublications,
      'run_as_owner', subscription.subrunasowner,
      'slot_name', subscription.subslotname,
      'streaming', subscription.substream,
      'synchronous_commit', subscription.subsynccommit,
      'two_phase', subscription.subtwophasestate
    )
  from pg_catalog.pg_subscription as subscription

  union all

  select
    'large-object',
    metadata_row.oid::text,
    pg_catalog.jsonb_build_object(
      'acl', coalesce(metadata_row.lomacl::text, '<null>'),
      'bytes_sha256', payload.bytes_sha256,
      'owner', pg_catalog.pg_get_userbyid(metadata_row.lomowner),
      'pages', payload.pages
    )
  from pg_catalog.pg_largeobject_metadata as metadata_row
  cross join lateral (
    select
      encode(
        extensions.digest(
          coalesce(
            pg_catalog.string_agg(
              large_object.data,
              ''::bytea
              order by large_object.pageno
            ),
            ''::bytea
          ),
          'sha256'
        ),
        'hex'
      ) as bytes_sha256,
      count(*) as pages
    from pg_catalog.pg_largeobject as large_object
    where large_object.loid = metadata_row.oid
  ) as payload
)
select pg_catalog.jsonb_build_array(category, label, value)::text
  from metadata
 order by category, label, value::text;
`;

const databaseUnsupportedMetadataSql = String.raw`
select (
  (
    select pg_catalog.shobj_description(
      database_row.oid,
      'pg_catalog.pg_database'
    ) is null
      from pg_catalog.pg_database as database_row
     where database_row.datname = current_database()
  )
  and not exists (
    select 1
      from pg_catalog.pg_shseclabel as security_label
      join pg_catalog.pg_database as database_row
        on security_label.classoid = 'pg_catalog.pg_database'::pg_catalog.regclass
       and security_label.objoid = database_row.oid
     where database_row.datname = current_database()
  )
)::text;
`;

const pgInitSourceSchemaAclBaselineSql = String.raw`
with target_schemas as (
  select namespace.oid, namespace.nspname, namespace.nspowner, namespace.nspacl
    from pg_catalog.pg_namespace as namespace
   where namespace.nspname in ('graphql', 'graphql_public')
),
expected_entries (nspname, grantee, grantor, privilege_type, is_grantable) as (
  values
    ('graphql', 'anon', 'supabase_admin', 'USAGE', false),
    ('graphql', 'authenticated', 'supabase_admin', 'USAGE', false),
    ('graphql', 'postgres', 'supabase_admin', 'USAGE', true),
    ('graphql', 'service_role', 'supabase_admin', 'USAGE', false),
    ('graphql', 'supabase_admin', 'supabase_admin', 'CREATE', false),
    ('graphql', 'supabase_admin', 'supabase_admin', 'USAGE', false),
    ('graphql_public', 'anon', 'supabase_admin', 'USAGE', false),
    ('graphql_public', 'authenticated', 'supabase_admin', 'USAGE', false),
    ('graphql_public', 'postgres', 'supabase_admin', 'USAGE', true),
    ('graphql_public', 'service_role', 'supabase_admin', 'USAGE', false),
    ('graphql_public', 'supabase_admin', 'supabase_admin', 'CREATE', false),
    ('graphql_public', 'supabase_admin', 'supabase_admin', 'USAGE', false)
),
actual_entries as (
  select
    namespace.nspname,
    case when acl_entry.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl_entry.grantee) end as grantee,
    pg_catalog.pg_get_userbyid(acl_entry.grantor) as grantor,
    acl_entry.privilege_type,
    acl_entry.is_grantable
  from target_schemas as namespace
  cross join lateral pg_catalog.aclexplode(namespace.nspacl) as acl_entry
),
baseline_entries as (
  select
    namespace.nspname,
    case when acl_entry.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl_entry.grantee) end as grantee,
    pg_catalog.pg_get_userbyid(acl_entry.grantor) as grantor,
    acl_entry.privilege_type,
    acl_entry.is_grantable
  from target_schemas as namespace
  join pg_catalog.pg_init_privs as initial_privilege
    on initial_privilege.classoid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
   and initial_privilege.objoid = namespace.oid
   and initial_privilege.objsubid = 0
   and initial_privilege.privtype = 'e'
  cross join lateral pg_catalog.aclexplode(initial_privilege.initprivs) as acl_entry
)
select (
  (select count(*) = 2 from target_schemas)
  and not exists (
    select 1
      from target_schemas as namespace
     where pg_catalog.pg_get_userbyid(namespace.nspowner) <> 'supabase_admin'
  )
  and not exists (
    (select * from expected_entries except select * from actual_entries)
    union all
    (select * from actual_entries except select * from expected_entries)
  )
  and not exists (
    (select * from expected_entries except select * from baseline_entries)
    union all
    (select * from baseline_entries except select * from expected_entries)
  )
)::text;
`;

const pgInitTargetSchemaAclRepairPreflightSql = String.raw`
select (
  (
    select count(*) = 2
      from pg_catalog.pg_namespace as namespace
     where namespace.nspname in ('graphql', 'graphql_public')
       and pg_catalog.pg_get_userbyid(namespace.nspowner) = 'supabase_admin'
       and namespace.nspacl is null
  )
  and not exists (
    select 1
      from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_init_privs as initial_privilege
        on initial_privilege.classoid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
       and initial_privilege.objoid = namespace.oid
       and initial_privilege.objsubid = 0
     where namespace.nspname in ('graphql', 'graphql_public')
  )
)::text;
`;

const pgInitSchemaAclRepairSql = String.raw`
begin;
grant usage on schema graphql, graphql_public to anon, authenticated, service_role;
grant usage on schema graphql, graphql_public to postgres with grant option;
commit;
`;

const databaseRepairSourceAclSql = String.raw`
with expected (grantee, grantor, privilege_type, is_grantable) as (
  values
    ('PUBLIC', 'postgres', 'CONNECT', false),
    ('PUBLIC', 'postgres', 'TEMPORARY', false),
    ('dashboard_user', 'postgres', 'CONNECT', false),
    ('dashboard_user', 'postgres', 'CREATE', false),
    ('dashboard_user', 'postgres', 'TEMPORARY', false),
    ('postgres', 'postgres', 'CONNECT', false),
    ('postgres', 'postgres', 'CREATE', false),
    ('postgres', 'postgres', 'TEMPORARY', false),
    ('supabase_etl_admin', 'postgres', 'CREATE', false),
    ('supabase_storage_admin', 'postgres', 'CREATE', false)
),
actual as (
  select
    case when acl_entry.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl_entry.grantee) end as grantee,
    pg_catalog.pg_get_userbyid(acl_entry.grantor) as grantor,
    acl_entry.privilege_type,
    acl_entry.is_grantable
  from pg_catalog.pg_database as database_row
  cross join lateral pg_catalog.aclexplode(database_row.datacl) as acl_entry
  where database_row.datname = current_database()
)
select (
  not exists (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
)::text;
`;

const databaseRepairTargetPreflightSql = String.raw`
select (
  (
    select database_row.datacl is null
      from pg_catalog.pg_database as database_row
     where database_row.datname = current_database()
  )
  and not exists (
    select 1
      from pg_catalog.pg_db_role_setting as setting_row
     where setting_row.setdatabase = (
       select database_row.oid
         from pg_catalog.pg_database as database_row
        where database_row.datname = current_database()
     )
  )
)::text;
`;

const databaseRepairSettingsSql = String.raw`
select pg_catalog.jsonb_build_array(
  pg_catalog.split_part(setting_value, '=', 1),
  pg_catalog.substr(setting_value, pg_catalog.strpos(setting_value, '=') + 1)
)::text
  from pg_catalog.pg_db_role_setting as setting_row
  cross join lateral pg_catalog.unnest(setting_row.setconfig) as setting_value
 where setting_row.setdatabase = (
   select database_row.oid
     from pg_catalog.pg_database as database_row
    where database_row.datname = current_database()
 )
   and setting_row.setrole = 0
 order by pg_catalog.split_part(setting_value, '=', 1);
`;

const allowedIdentifier = /^[a-z_][a-z0-9_]*$/;
const allowedCatalogCategories = new Set([
  "column",
  "constraint",
  "default-acl",
  "extension",
  "function",
  "index",
  "policy",
  "relation",
  "schema",
  "sequence-state",
  "trigger",
  "type",
]);
const allowedCatalogDiagnosticFields = new Map([
  [
    "column",
    new Set([
      "acl",
      "comment",
      "default",
      "generated",
      "identity",
      "not_null",
      "position",
      "type",
    ]),
  ],
  [
    "relation",
    new Set([
      "acl",
      "comment",
      "force_rls",
      "kind",
      "options",
      "owner",
      "persistence",
      "replica_identity",
      "rls",
      "view",
    ]),
  ],
]);
const tableOwnerPrivileges = new Set([
  "DELETE",
  "INSERT",
  "MAINTAIN",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
]);
const allowedOwnerAclDisappearance = new Map([
  ["private.account_closure_memberships", tableOwnerPrivileges],
  ["private.account_closure_requests", tableOwnerPrivileges],
  ["private.audit_events", tableOwnerPrivileges],
  ["private.audit_events_id_seq", new Set(["SELECT", "UPDATE", "USAGE"])],
  ["private.export_jobs", tableOwnerPrivileges],
  ["private.invitation_jobs", tableOwnerPrivileges],
  ["private.invitations", tableOwnerPrivileges],
  ["private.photo_intakes", tableOwnerPrivileges],
]);

function quoteIdentifier(identifier) {
  if (!allowedIdentifier.test(identifier)) {
    throw new DrillError("database manifest identifier guard");
  }
  return `"${identifier}"`;
}

function encodedSqlTextExpression(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value)) {
    throw new DrillError("database repair setting value guard");
  }
  const encoded = Buffer.from(value, "utf8").toString("base64");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new DrillError("database repair setting value guard");
  }
  return `pg_catalog.convert_from(pg_catalog.decode('${encoded}', 'base64'), 'UTF8')`;
}

function readDatabaseRepairSettings(database, snapshot) {
  const output = runDatabaseQuery(
    database,
    databaseRepairSettingsSql,
    "database repair settings sidecar",
    snapshot,
  );
  const settingsFingerprint = hash(output);
  if (settingsFingerprint !== expectedDatabaseRepairSettingsFingerprint) {
    throw new DrillError("database repair settings sidecar fingerprint");
  }

  const entries = [];
  for (const line of output.trim().split("\n").filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new DrillError("database repair settings sidecar");
    }
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !entry.every((value) => typeof value === "string")
    ) {
      throw new DrillError("database repair settings sidecar");
    }
    entries.push(entry);
  }

  const settings = new Map(entries);
  if (
    entries.length !== 2 ||
    settings.size !== 2 ||
    settings.get("app.settings.jwt_exp") !== "3600" ||
    !/^[^\s]{32,256}$/.test(settings.get("app.settings.jwt_secret") ?? "")
  ) {
    throw new DrillError("database repair settings sidecar allowlist");
  }
  return settings;
}

function buildDatabaseRepairSql(database, settings) {
  const databaseIdentifier = quoteIdentifier(database);
  const jwtExpiration = encodedSqlTextExpression(
    settings.get("app.settings.jwt_exp"),
  );
  const jwtSecret = encodedSqlTextExpression(
    settings.get("app.settings.jwt_secret"),
  );
  return `begin;
grant create on database ${databaseIdentifier} to supabase_etl_admin, supabase_storage_admin;
grant connect, create, temporary on database ${databaseIdentifier} to dashboard_user;
select pg_catalog.set_config('app.settings.jwt_exp', ${jwtExpiration}, true);
alter database ${databaseIdentifier} set app.settings.jwt_exp from current;
select pg_catalog.set_config('app.settings.jwt_secret', ${jwtSecret}, true);
alter database ${databaseIdentifier} set app.settings.jwt_secret from current;
commit;
`;
}

function readManifest(database, snapshot = null) {
  const schemaInventoryOutput = runDatabaseQuery(
    database,
    reviewedSchemaInventorySql,
    "reviewed schema inventory",
    snapshot,
  );
  const schemaInventory = schemaInventoryOutput
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!inventoryMatches(schemaInventory, reviewedSchemas)) {
    throw new DrillError("reviewed schema inventory");
  }
  const bucketOutput = runDatabaseQuery(
    database,
    privateBucketInventorySql,
    "private bucket inventory",
    snapshot,
  );
  let bucketInventory;
  try {
    bucketInventory = bucketOutput
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch {
    throw new DrillError("private bucket inventory");
  }
  if (!bucketInventoryMatches(bucketInventory)) {
    throw new DrillError("private bucket inventory");
  }

  const catalog = runDatabaseQuery(
    database,
    catalogManifestSql,
    "schema catalog manifest",
    snapshot,
  );
  const catalogSections = new Map();
  for (const line of catalog.trim().split("\n").filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new DrillError("schema catalog manifest");
    }
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      !entry.every((value) => typeof value === "string") ||
      !allowedCatalogCategories.has(entry[0])
    ) {
      throw new DrillError("schema catalog manifest");
    }
    const [category] = entry;
    const entries = catalogSections.get(category) ?? [];
    entries.push(line);
    catalogSections.set(category, entries);
  }
  const tableListOutput = runDatabaseQuery(
    database,
    dataTableListSql,
    "data table manifest",
    snapshot,
  );
  const catalogFieldOutput = runDatabaseQuery(
    database,
    catalogFieldDiagnosticSql,
    "catalog field manifest",
    snapshot,
  );
  const aclProvenanceOutput = runDatabaseQuery(
    database,
    aclProvenanceManifestSql,
    "ACL provenance manifest",
    snapshot,
  );
  const aclProvenanceRows = [];
  for (const line of aclProvenanceOutput.trim().split("\n").filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new DrillError("ACL provenance manifest");
    }
    if (
      !Array.isArray(entry) ||
      entry.length !== 7 ||
      !entry.slice(0, 6).every((value) => typeof value === "string") ||
      typeof entry[6] !== "boolean" ||
      !allowedCatalogCategories.has(entry[0])
    ) {
      throw new DrillError("ACL provenance manifest");
    }
    aclProvenanceRows.push(entry);
  }
  const reviewedRelationAclStateOutput = runDatabaseQuery(
    database,
    reviewedRelationAclStateSql,
    "reviewed relation ACL state manifest",
    snapshot,
  );
  const reviewedRelationAclStates = new Map();
  for (const line of reviewedRelationAclStateOutput
    .trim()
    .split("\n")
    .filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new DrillError("reviewed relation ACL state manifest");
    }
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      typeof entry[0] !== "string" ||
      !allowedOwnerAclDisappearance.has(entry[0]) ||
      typeof entry[1] !== "string" ||
      typeof entry[2] !== "boolean"
    ) {
      throw new DrillError("reviewed relation ACL state manifest");
    }
    reviewedRelationAclStates.set(entry[0], {
      aclIsNull: entry[2],
      owner: entry[1],
    });
  }
  if (reviewedRelationAclStates.size !== allowedOwnerAclDisappearance.size) {
    throw new DrillError("reviewed relation ACL state manifest");
  }
  const catalogFields = new Map();
  for (const line of catalogFieldOutput.trim().split("\n").filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new DrillError("catalog field manifest");
    }
    if (
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string" ||
      typeof entry[2] !== "string" ||
      !allowedCatalogDiagnosticFields.get(entry[0])?.has(entry[2])
    ) {
      throw new DrillError("catalog field manifest");
    }
    catalogFields.set(`${entry[0]}:${entry[1]}:${entry[2]}`, hash(line));
  }
  const tableNames = tableListOutput
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\x1f"));

  const normalizedTableDigests = [];
  const rawTableDigests = [];
  for (const parts of tableNames) {
    if (parts.length !== 2) {
      throw new DrillError("data table manifest");
    }
    const [schema, table] = parts;
    const rows = runDatabaseQuery(
      database,
      `select to_jsonb(row_value)::text\nfrom ${quoteIdentifier(schema)}.${quoteIdentifier(table)} as row_value\norder by to_jsonb(row_value)::text;\n`,
      "table data manifest",
      snapshot,
    );
    const identity = `${schema}.${table}`;
    const normalizedRows = [];
    for (const line of rows.trim().split("\n").filter(Boolean)) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new DrillError("table data manifest");
      }
      normalizedRows.push(
        JSON.stringify(canonicalJson(normalizeFixtureRow(identity, row))),
      );
    }
    normalizedRows.sort();
    normalizedTableDigests.push(
      `${schema}\x1f${table}\x1f${hash(normalizedRows.join("\n"))}`,
    );
    rawTableDigests.push(`${schema}\x1f${table}\x1f${hash(rows)}`);
  }

  const metadataOutput = runDatabaseQuery(
    database,
    databaseMetadataSql,
    "database archive metadata",
    snapshot,
  );
  const schemaFingerprint = readSchemaDumpFingerprint(database, snapshot);

  return {
    aclProvenance: hash(aclProvenanceOutput),
    aclProvenanceRows,
    catalog: hash(catalog),
    catalogFields,
    catalogSections: new Map(
      [...catalogSections].map(([category, entries]) => [
        category,
        hash(entries.join("\n")),
      ]),
    ),
    data: hash(rawTableDigests.join("\n")),
    databaseMetadata: hash(metadataOutput),
    migrations: hash(
      runDatabaseQuery(
        database,
        migrationHistorySql,
        "migration history manifest",
        snapshot,
      ),
    ),
    normalizedData: hash(normalizedTableDigests.join("\n")),
    reviewedRelationAclState: hash(reviewedRelationAclStateOutput),
    reviewedRelationAclStates,
    schemaFingerprint,
    tables: hash(tableListOutput),
  };
}

function assertManifestMatches(left, right, stage) {
  if (
    left.aclProvenance !== right.aclProvenance ||
    left.catalog !== right.catalog ||
    left.data !== right.data ||
    left.databaseMetadata !== right.databaseMetadata ||
    left.migrations !== right.migrations ||
    left.normalizedData !== right.normalizedData ||
    left.reviewedRelationAclState !== right.reviewedRelationAclState ||
    left.schemaFingerprint !== right.schemaFingerprint ||
    left.tables !== right.tables
  ) {
    throw new DrillError(stage);
  }
}

function rowFrequencies(rows) {
  const frequencies = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  return frequencies;
}

function verifyAclRepresentationBoundary(source, restored) {
  let reviewedStatesExact = true;
  for (const identity of allowedOwnerAclDisappearance.keys()) {
    const sourceState = source.reviewedRelationAclStates.get(identity);
    const restoredState = restored.reviewedRelationAclStates.get(identity);
    if (sourceState.owner !== restoredState.owner) {
      throw new DrillError("reviewed ACL representation boundary");
    }
    reviewedStatesExact &&= sourceState.aclIsNull === restoredState.aclIsNull;
  }

  if (source.aclProvenance === restored.aclProvenance) {
    if (!reviewedStatesExact) {
      throw new DrillError("reviewed ACL representation boundary");
    }
    return;
  }

  for (const identity of allowedOwnerAclDisappearance.keys()) {
    const sourceState = source.reviewedRelationAclStates.get(identity);
    const restoredState = restored.reviewedRelationAclStates.get(identity);
    if (sourceState.aclIsNull || !restoredState.aclIsNull) {
      throw new DrillError("reviewed ACL representation boundary");
    }
  }

  const sourceFrequencies = rowFrequencies(source.aclProvenanceRows);
  const restoredFrequencies = rowFrequencies(restored.aclProvenanceRows);
  const rowKeys = new Set([
    ...sourceFrequencies.keys(),
    ...restoredFrequencies.keys(),
  ]);
  const sourceOnlyRows = [];
  const restoredOnlyRows = [];
  for (const key of rowKeys) {
    const difference =
      (sourceFrequencies.get(key) ?? 0) - (restoredFrequencies.get(key) ?? 0);
    const destination = difference > 0 ? sourceOnlyRows : restoredOnlyRows;
    for (let index = 0; index < Math.abs(difference); index += 1) {
      destination.push(key);
    }
  }

  const expectedSourceOnlyRows = [];
  for (const [identity, privileges] of allowedOwnerAclDisappearance) {
    for (const privilege of privileges) {
      expectedSourceOnlyRows.push(
        JSON.stringify([
          "relation",
          identity,
          "postgres",
          "postgres",
          "postgres",
          privilege,
          false,
        ]),
      );
    }
  }

  if (
    restoredOnlyRows.length !== 0 ||
    JSON.stringify(sourceOnlyRows.sort()) !==
      JSON.stringify(expectedSourceOnlyRows.sort())
  ) {
    throw new DrillError("reviewed ACL representation boundary");
  }
}

function assertDatabaseBoolean(database, sql, stage, snapshot = null) {
  if (runDatabaseQuery(database, sql, stage, snapshot).trim() !== "true") {
    throw new DrillError(stage);
  }
}

function verifyAccessBehavior(database) {
  assertDatabaseBoolean(
    database,
    String.raw`
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
select (
  (select count(*) = 1 from public.circles)
  and exists (
    select 1 from public.circles
     where id = '20000000-0000-4000-8000-000000000001'::uuid
  )
  and not exists (
    select 1 from public.circles
     where id = '20000000-0000-4000-8000-000000000002'::uuid
  )
)::text;
rollback;
`,
    "row authorization fidelity",
  );

  assertDatabaseBoolean(
    database,
    String.raw`
select (
  pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
  and not exists (
    select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname = 'private'
       and relation.relkind in ('r', 'p')
       and (
         pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT')
         or pg_catalog.has_table_privilege('authenticated', relation.oid, 'INSERT')
         or pg_catalog.has_table_privilege('authenticated', relation.oid, 'UPDATE')
         or pg_catalog.has_table_privilege('authenticated', relation.oid, 'DELETE')
         or pg_catalog.has_table_privilege('authenticated', relation.oid, 'TRUNCATE')
         or pg_catalog.has_table_privilege('authenticated', relation.oid, 'REFERENCES')
         or pg_catalog.has_table_privilege('authenticated', relation.oid, 'TRIGGER')
       )
  )
)::text;
`,
    "private table authorization fidelity",
  );

  runDatabaseQuery(
    database,
    String.raw`
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
do $storage_denial$
declare
  denied boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('our-days-originals', 'logical-restore-access-canary');
  exception
    when sqlstate '42501' then denied := true;
  end;

  if not denied then
    raise exception using
      errcode = 'P0001',
      message = 'Storage authorization canary unexpectedly succeeded';
  end if;
end
$storage_denial$;
rollback;
`,
    "storage authorization fidelity",
  );
}

function verifyLocalBoundary() {
  const config = readFileSync(configPath, "utf8");
  if (
    process.env.DOCKER_HOST ||
    process.env.DOCKER_CONTEXT ||
    existsSync(linkedProjectRefPath) ||
    existsSync(legacyLinkedProjectRefPath) ||
    !/^project_id = "our-days"$/m.test(config) ||
    !/^port = 54322$/m.test(config) ||
    !/^major_version = 17$/m.test(config)
  ) {
    throw new DrillError("local project guard");
  }

  const dockerEndpoint = runDocker(
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { capture: true, stage: "local Docker context guard" },
  ).trim();
  if (!dockerEndpoint.startsWith("unix://")) {
    throw new DrillError("local Docker context guard");
  }

  const containerRecord = runDocker(
    [
      "ps",
      "-a",
      "--filter",
      `name=^/${databaseContainer}$`,
      "--format",
      "{{.Names}}|{{.Image}}|{{.Status}}",
    ],
    { capture: true, stage: "local container guard" },
  ).trim();
  const [name, image, status] = containerRecord.split("|");
  if (
    name !== databaseContainer ||
    !/(?:^|\/)postgres:17[.]/.test(image ?? "") ||
    !/^Up .+\(healthy\)$/.test(status ?? "")
  ) {
    throw new DrillError("local container guard");
  }

  const version = Number.parseInt(
    runDatabaseQuery(
      "postgres",
      "show server_version_num;\n",
      "Postgres version guard",
    ).trim(),
    10,
  );
  if (!Number.isInteger(version) || version < 170_000 || version >= 180_000) {
    throw new DrillError("Postgres version guard");
  }

  const restoreIdentityReady = runDocker(
    [
      "exec",
      databaseContainer,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "supabase_admin",
      "--dbname",
      "postgres",
      "--command",
      "select (current_user = 'supabase_admin' and current_setting('is_superuser') = 'on')::text;",
    ],
    { capture: true, stage: "local restore identity guard" },
  ).trim();
  if (restoreIdentityReady !== "true") {
    throw new DrillError("local restore identity guard");
  }
}

function fixedCatalogFieldLabel(key) {
  const firstSeparator = key.indexOf(":");
  const lastSeparator = key.lastIndexOf(":");
  const category = key.slice(0, firstSeparator);
  const field = key.slice(lastSeparator + 1);
  return allowedCatalogDiagnosticFields.get(category)?.has(field)
    ? `${category}.${field}`
    : null;
}

function compareRestoredManifest(source, restored) {
  verifyAclRepresentationBoundary(source, restored);
  console.log("PASS: reviewed ACL representation boundary");

  if (source.catalog !== restored.catalog) {
    const categories = new Set([
      ...source.catalogSections.keys(),
      ...restored.catalogSections.keys(),
    ]);
    const mismatches = [...categories]
      .filter(
        (category) =>
          source.catalogSections.get(category) !==
          restored.catalogSections.get(category),
      )
      .sort();
    const fieldKeys = new Set([
      ...source.catalogFields.keys(),
      ...restored.catalogFields.keys(),
    ]);
    const fieldMismatches = [...fieldKeys].filter(
      (key) =>
        source.catalogFields.get(key) !== restored.catalogFields.get(key),
    );
    const fixedFieldLabels = new Set();
    for (const key of fieldMismatches) {
      const label = fixedCatalogFieldLabel(key);
      if (label) fixedFieldLabels.add(label);
    }
    const diagnostics = fixedFieldLabels.size
      ? [...fixedFieldLabels].sort().join(", ")
      : mismatches.join(", ");
    throw new DrillError(
      `schema and effective authorization fidelity (${diagnostics})`,
    );
  }
  console.log("PASS: schema and effective authorization fidelity");

  if (source.tables !== restored.tables || source.data !== restored.data) {
    throw new DrillError("database data fidelity");
  }
  if (source.normalizedData !== restored.normalizedData) {
    throw new DrillError("normalized database data fidelity");
  }
  console.log("PASS: database data fidelity");

  if (source.databaseMetadata !== restored.databaseMetadata) {
    throw new DrillError("database archive metadata fidelity");
  }
  console.log("PASS: database archive metadata fidelity");

  if (source.migrations !== restored.migrations) {
    throw new DrillError("migration history fidelity");
  }
  console.log("PASS: migration history fidelity");
}

function assertCanonicalSourceManifest(manifest) {
  if (manifest.schemaFingerprint !== expectedCanonicalSchemaFingerprint) {
    throw new DrillError("canonical schema archive fingerprint");
  }
  if (manifest.catalog !== expectedCanonicalCatalogFingerprint) {
    throw new DrillError("canonical catalog fingerprint");
  }
  if (manifest.normalizedData !== expectedCanonicalDataFingerprint) {
    throw new DrillError("canonical normalized data fingerprint");
  }
  if (manifest.databaseMetadata !== expectedDatabaseMetadataFingerprint) {
    throw new DrillError("canonical database metadata fingerprint");
  }
}

async function runStaticSelfTest() {
  if (
    inventoryMatches([...reviewedSchemas, "unexpected_schema"], reviewedSchemas)
  ) {
    throw new DrillError("static unexpected-schema rejection");
  }
  if (!bucketInventoryMatches(expectedPrivateBuckets)) {
    throw new DrillError("static exact-bucket acceptance");
  }
  if (
    bucketInventoryMatches([
      ...expectedPrivateBuckets,
      { ...expectedPrivateBuckets[0], id: "unexpected-fourth-bucket" },
    ])
  ) {
    throw new DrillError("static fourth-bucket rejection");
  }
  if (
    !unsupportedDatabaseMetadataIsEmpty(null, 0) ||
    unsupportedDatabaseMetadataIsEmpty("unexpected", 0) ||
    unsupportedDatabaseMetadataIsEmpty(null, 1)
  ) {
    throw new DrillError("static unsupported database metadata rejection");
  }

  const normalizedStorageMigration = normalizeFixtureRow("storage.migrations", {
    executed_at: "volatile",
    hash: "stable",
    id: 1,
    name: "stable",
  });
  const normalizedFunctionsMigration = normalizeFixtureRow(
    "supabase_functions.migrations",
    { inserted_at: "volatile", version: "stable" },
  );
  if (
    normalizedStorageMigration.executed_at !== "<present>" ||
    normalizedStorageMigration.hash !== "stable" ||
    normalizedStorageMigration.id !== 1 ||
    normalizedStorageMigration.name !== "stable" ||
    normalizedFunctionsMigration.inserted_at !== "<present>" ||
    normalizedFunctionsMigration.version !== "stable"
  ) {
    throw new DrillError("static platform migration timestamp normalization");
  }

  const privateMarker = "private_schema.private_table.private_column";
  const category = classifyProcessFailure(
    `permission denied: ${privateMarker}`,
  );
  if (
    !allowedProcessFailureCategories.has(category) ||
    category.includes(privateMarker)
  ) {
    throw new DrillError("static diagnostic redaction");
  }
  const fieldLabel = fixedCatalogFieldLabel(`column:${privateMarker}:type`);
  if (fieldLabel !== "column.type" || fieldLabel.includes(privateMarker)) {
    throw new DrillError("static diagnostic redaction");
  }

  let failures = 0;
  const retainedAfterFailure = retainedCleanupFlag(true, () => {
    failures += 1;
    return false;
  });
  if (!retainedAfterFailure || failures !== 3) {
    throw new DrillError("static cleanup failure retention");
  }
  let attempts = 0;
  const retainedAfterRetrySuccess = retainedCleanupFlag(true, () => {
    attempts += 1;
    return attempts === 3;
  });
  if (retainedAfterRetrySuccess || attempts !== 3) {
    throw new DrillError("static cleanup retry success");
  }

  const staticDatabase = `our_days_restore_${"a".repeat(32)}`;
  const staticRepairSql = buildDatabaseRepairSql(
    staticDatabase,
    new Map([
      ["app.settings.jwt_exp", "3600"],
      ["app.settings.jwt_secret", "x".repeat(40)],
    ]),
  );
  const staticRepairLines = staticRepairSql.trim().split("\n");
  if (
    !inventoryMatches(staticRepairLines, [
      "begin;",
      `grant create on database "${staticDatabase}" to supabase_etl_admin, supabase_storage_admin;`,
      `grant connect, create, temporary on database "${staticDatabase}" to dashboard_user;`,
      `select pg_catalog.set_config('app.settings.jwt_exp', ${encodedSqlTextExpression("3600")}, true);`,
      `alter database "${staticDatabase}" set app.settings.jwt_exp from current;`,
      `select pg_catalog.set_config('app.settings.jwt_secret', ${encodedSqlTextExpression("x".repeat(40))}, true);`,
      `alter database "${staticDatabase}" set app.settings.jwt_secret from current;`,
      "commit;",
    ])
  ) {
    throw new DrillError("static database repair allowlist");
  }
  const escapedStaticSecret = `${"y".repeat(32)}'\\private`;
  const escapedStaticSql = buildDatabaseRepairSql(
    staticDatabase,
    new Map([
      ["app.settings.jwt_exp", "3600"],
      ["app.settings.jwt_secret", escapedStaticSecret],
    ]),
  );
  if (
    escapedStaticSql.includes(escapedStaticSecret) ||
    !escapedStaticSql.includes(encodedSqlTextExpression(escapedStaticSecret))
  ) {
    throw new DrillError("static database repair value encoding");
  }
  let rejectedUnsafeSetting = false;
  try {
    encodedSqlTextExpression(`${"z".repeat(32)}\nprivate`);
  } catch (error) {
    rejectedUnsafeSetting = error instanceof DrillError;
  }
  if (!rejectedUnsafeSetting) {
    throw new DrillError("static database repair value rejection");
  }

  class FakeExporterChild extends EventEmitter {
    constructor({
      exitOnEnd = false,
      exitOnKill = false,
      exitOnTerm = false,
    } = {}) {
      super();
      this.exitCode = null;
      this.signalCode = null;
      this.endCalls = 0;
      this.signals = [];
      this.exitOnEnd = exitOnEnd;
      this.exitOnKill = exitOnKill;
      this.exitOnTerm = exitOnTerm;
      this.stdin = {
        end: () => {
          this.endCalls += 1;
          if (this.exitOnEnd) queueMicrotask(() => this.confirmExit(0, null));
        },
      };
    }

    confirmExit(code, signal) {
      if (this.exitCode !== null || this.signalCode !== null) return;
      this.exitCode = code;
      this.signalCode = signal;
      this.emit("exit", code, signal);
    }

    kill(signal) {
      this.signals.push(signal);
      if (signal === "SIGTERM" && this.exitOnTerm) {
        queueMicrotask(() => this.confirmExit(null, "SIGTERM"));
      }
      if (signal === "SIGKILL" && this.exitOnKill) {
        queueMicrotask(() => this.confirmExit(null, "SIGKILL"));
      }
      return true;
    }
  }

  const shortStopOptions = {
    gracefulTimeoutMs: 5,
    killTimeoutMs: 20,
    termTimeoutMs: 5,
  };
  const gracefulChild = new FakeExporterChild({ exitOnEnd: true });
  const gracefulStop = await stopSnapshotExporterChild(
    gracefulChild,
    shortStopOptions,
  );
  if (
    !gracefulStop.clean ||
    !gracefulStop.confirmed ||
    gracefulChild.signals.length !== 0 ||
    gracefulChild.listenerCount("exit") !== 0
  ) {
    throw new DrillError("static snapshot graceful cleanup");
  }

  const termChild = new FakeExporterChild({ exitOnTerm: true });
  const termStop = await stopSnapshotExporterChild(termChild, shortStopOptions);
  if (
    termStop.clean ||
    !termStop.confirmed ||
    !inventoryMatches(termChild.signals, ["SIGTERM"]) ||
    termChild.listenerCount("exit") !== 0
  ) {
    throw new DrillError("static snapshot TERM cleanup");
  }

  const killChild = new FakeExporterChild({ exitOnKill: true });
  const killStop = await stopSnapshotExporterChild(killChild, shortStopOptions);
  if (
    killStop.clean ||
    !killStop.confirmed ||
    !inventoryMatches(killChild.signals, ["SIGTERM", "SIGKILL"]) ||
    killChild.listenerCount("exit") !== 0
  ) {
    throw new DrillError("static snapshot SIGKILL cleanup");
  }

  const resistantChild = new FakeExporterChild();
  const resistantStop = await stopSnapshotExporterChild(
    resistantChild,
    shortStopOptions,
  );
  if (
    resistantStop.clean ||
    resistantStop.confirmed ||
    !inventoryMatches(resistantChild.signals, ["SIGTERM", "SIGKILL"]) ||
    resistantChild.listenerCount("exit") !== 0
  ) {
    throw new DrillError("static snapshot resistant cleanup");
  }

  const racedChild = new FakeExporterChild();
  racedChild.confirmExit(0, null);
  const racedStop = await stopSnapshotExporterChild(
    racedChild,
    shortStopOptions,
  );
  if (!racedStop.clean || !racedStop.confirmed) {
    throw new DrillError("static snapshot exit race");
  }

  const concurrentChild = new FakeExporterChild({ exitOnEnd: true });
  snapshotExporter = concurrentChild;
  snapshotExporterBackendPid = 123;
  let backendVerifications = 0;
  const closeOptions = {
    stopOptions: shortStopOptions,
    verifyBackendAbsent: async (backendPid) => {
      backendVerifications += 1;
      return backendPid === 123;
    },
  };
  const concurrentResults = await Promise.all([
    closeSnapshotExporter(closeOptions),
    closeSnapshotExporter(closeOptions),
  ]);
  if (
    !inventoryMatches(concurrentResults, [
      { absent: true, graceful: true },
      { absent: true, graceful: true },
    ]) ||
    concurrentChild.endCalls !== 1 ||
    backendVerifications !== 1 ||
    snapshotExporter !== null ||
    snapshotExporterBackendPid !== null ||
    snapshotExporterClosePromise !== null
  ) {
    throw new DrillError("static snapshot concurrent cleanup");
  }

  const retainedChild = new FakeExporterChild();
  snapshotExporter = retainedChild;
  snapshotExporterBackendPid = 124;
  const retainedResult = await closeSnapshotExporter({
    stopOptions: shortStopOptions,
    verifyBackendAbsent: async () => true,
  });
  if (
    retainedResult.absent ||
    retainedResult.graceful ||
    snapshotExporter !== retainedChild ||
    snapshotExporterBackendPid !== 124 ||
    snapshotExporterClosePromise !== null
  ) {
    throw new DrillError("static snapshot resistant retention");
  }
  retainedChild.confirmExit(null, "SIGKILL");
  snapshotExporter = null;
  snapshotExporterBackendPid = null;

  const forcedChild = new FakeExporterChild({ exitOnTerm: true });
  snapshotExporter = forcedChild;
  snapshotExporterBackendPid = 125;
  snapshotExporterErrorState = { hadError: false };
  snapshotExporterErrorHandler = attachChildErrorRecorder(
    forcedChild,
    snapshotExporterErrorState,
  );
  const forcedResult = await closeSnapshotExporter({
    stopOptions: shortStopOptions,
    verifyBackendAbsent: async () => true,
  });
  if (
    !forcedResult.absent ||
    forcedResult.graceful ||
    snapshotExporter !== null ||
    snapshotExporterBackendPid !== null ||
    snapshotExporterErrorHandler !== null ||
    snapshotExporterErrorState !== null
  ) {
    throw new DrillError("static snapshot forced absence");
  }

  const errorChild = new FakeExporterChild();
  const errorState = { hadError: false };
  const errorHandler = attachChildErrorRecorder(errorChild, errorState);
  errorChild.emit("error", new Error("private diagnostic marker"));
  errorChild.removeListener("error", errorHandler);
  if (errorState.hadError !== true || errorChild.listenerCount("error") !== 0) {
    throw new DrillError("static snapshot process error handling");
  }

  const staticApplicationName = `od_snapshot_${"b".repeat(32)}`;
  let absenceChecks = 0;
  let terminationCalls = 0;
  const terminatedBackendAbsent = await ensureSnapshotExporterBackendAbsent(
    126,
    staticApplicationName,
    {
      initialPollAttempts: 2,
      isAbsent: async (backendPid, applicationName) => {
        if (backendPid !== 126 || applicationName !== staticApplicationName) {
          throw new DrillError("static snapshot backend identity propagation");
        }
        absenceChecks += 1;
        return absenceChecks >= 3;
      },
      pollDelayMs: 0,
      terminateBackend: async (backendPid, applicationName) => {
        terminationCalls += 1;
        return backendPid === 126 && applicationName === staticApplicationName;
      },
      terminationPollAttempts: 2,
      wait: async () => {},
    },
  );
  if (
    !terminatedBackendAbsent ||
    absenceChecks !== 3 ||
    terminationCalls !== 1
  ) {
    throw new DrillError("static snapshot backend termination");
  }

  const resistantBackendAbsent = await ensureSnapshotExporterBackendAbsent(
    127,
    staticApplicationName,
    {
      initialPollAttempts: 2,
      isAbsent: async () => false,
      pollDelayMs: 0,
      terminateBackend: async () => true,
      terminationPollAttempts: 2,
      wait: async () => {},
    },
  );
  if (resistantBackendAbsent) {
    throw new DrillError("static snapshot backend resistant retention");
  }

  for (const fingerprint of [
    expectedArchiveInventoryFingerprint,
    expectedCanonicalCatalogFingerprint,
    expectedCanonicalDataFingerprint,
    expectedCanonicalSchemaFingerprint,
    expectedDatabaseMetadataFingerprint,
    expectedDatabaseRepairSettingsFingerprint,
    expectedRestoredSchemaFingerprint,
  ]) {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new DrillError("static committed fingerprint format");
    }
  }
}

async function performDrill() {
  assertTemporaryTargets();
  acquireLock();
  verifyLocalBoundary();
  console.log("PASS: local project and PG17 boundary");

  const fixtureSourceChanges = runProcess(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "supabase/migrations",
      "supabase/seed.sql",
    ],
    { capture: true, stage: "committed fixture source guard" },
  );
  if (fixtureSourceChanges.trim()) {
    throw new DrillError("committed fixture source guard");
  }
  const migrationFiles = readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (
    JSON.stringify(migrationFiles) !== JSON.stringify(expectedMigrationFiles)
  ) {
    throw new DrillError("committed fixture source guard");
  }
  console.log("PASS: committed fixture source guard");

  const sourceSnapshot = await startSnapshotExporter();
  console.log("PASS: canonical source snapshot boundary");

  assertDatabaseBoolean(
    "postgres",
    syntheticPreflightSql,
    "synthetic-only preflight",
    sourceSnapshot,
  );
  console.log("PASS: synthetic-only preflight");

  assertDatabaseBoolean(
    "postgres",
    canonicalFixtureSql,
    "canonical synthetic source",
    sourceSnapshot,
  );
  console.log("PASS: canonical synthetic source");

  assertDatabaseBoolean(
    "postgres",
    pgInitSourceSchemaAclBaselineSql,
    "canonical extension initial-privilege baseline",
    sourceSnapshot,
  );
  console.log("PASS: canonical extension initial-privilege baseline");

  assertDatabaseBoolean(
    "postgres",
    databaseRepairSourceAclSql,
    "canonical database ACL sidecar baseline",
    sourceSnapshot,
  );
  const databaseRepairSettings = readDatabaseRepairSettings(
    "postgres",
    sourceSnapshot,
  );
  console.log("PASS: canonical database repair sidecar");

  assertDatabaseBoolean(
    "postgres",
    databaseUnsupportedMetadataSql,
    "unsupported source database metadata rejection",
    sourceSnapshot,
  );
  console.log("PASS: unsupported source database metadata rejection");

  const sourceBeforeDump = readManifest("postgres", sourceSnapshot);
  assertCanonicalSourceManifest(sourceBeforeDump);
  console.log("PASS: independently pinned canonical source");

  runDocker(["exec", databaseContainer, "test", "!", "-e", dumpPath], {
    stage: "private logical archive target guard",
  });
  dumpCreated = true;
  runDocker(
    ["exec", databaseContainer, "install", "-m", "600", "/dev/null", dumpPath],
    { stage: "private logical archive" },
  );

  runDocker(
    [
      "exec",
      databaseContainer,
      "pg_dump",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
      "--no-password",
      "--format=custom",
      "--compress=0",
      `--snapshot=${sourceSnapshot}`,
      "--lock-wait-timeout=5s",
      "--file",
      dumpPath,
    ],
    { stage: "logical archive", timeout: 180_000 },
  );
  const archiveList = runDocker(
    ["exec", databaseContainer, "pg_restore", "--list", dumpPath],
    { capture: true, stage: "logical archive validation" },
  );
  const archiveInventoryFingerprint = hash(
    normalizeArchiveInventory(archiveList),
  );
  if (archiveInventoryFingerprint !== expectedArchiveInventoryFingerprint) {
    throw new DrillError("canonical logical archive inventory");
  }

  const sourceAfterDump = readManifest("postgres", sourceSnapshot);
  assertManifestMatches(
    sourceBeforeDump,
    sourceAfterDump,
    "source stability during archive",
  );
  const snapshotClose = await closeSnapshotExporter();
  if (!snapshotClose.absent || !snapshotClose.graceful) {
    throw new DrillError("source snapshot cleanup");
  }
  console.log("PASS: consistent logical archive");

  assertDatabaseBoolean(
    "postgres",
    `select (not exists (select 1 from pg_catalog.pg_database where datname = '${restoreDatabase}'))::text;\n`,
    "isolated restore database target guard",
  );
  restoreDatabaseCreated = true;
  runDocker(
    [
      "exec",
      databaseContainer,
      "createdb",
      "--username",
      "postgres",
      "--maintenance-db",
      "postgres",
      "--owner",
      "postgres",
      "--template",
      "template0",
      restoreDatabase,
    ],
    { stage: "isolated restore database" },
  );

  runDocker(
    [
      "exec",
      databaseContainer,
      "pg_restore",
      "--username",
      "supabase_admin",
      "--dbname",
      restoreDatabase,
      "--exit-on-error",
      "--single-transaction",
      dumpPath,
    ],
    {
      classifyFailure: true,
      stage: "isolated logical restore",
      timeout: 180_000,
    },
  );
  console.log("PASS: isolated logical restore");

  assertDatabaseBoolean(
    restoreDatabase,
    databaseUnsupportedMetadataSql,
    "unsupported target database metadata rejection",
  );
  console.log("PASS: unsupported target database metadata rejection");

  assertDatabaseBoolean(
    restoreDatabase,
    pgInitTargetSchemaAclRepairPreflightSql,
    "extension initial-privilege restore preflight",
  );
  runDatabaseQuery(
    restoreDatabase,
    pgInitSchemaAclRepairSql,
    "extension initial-privilege restore repair",
    null,
    "supabase_admin",
  );
  console.log("PASS: exact extension initial-privilege repair");

  assertDatabaseBoolean(
    restoreDatabase,
    databaseRepairTargetPreflightSql,
    "database repair sidecar target preflight",
  );
  runDatabaseQuery(
    restoreDatabase,
    buildDatabaseRepairSql(restoreDatabase, databaseRepairSettings),
    "database repair sidecar application",
    null,
    "supabase_admin",
  );
  console.log("PASS: exact database repair sidecar");

  assertDatabaseBoolean(
    restoreDatabase,
    canonicalFixtureSql,
    "restored canonical fixtures",
  );
  const restoredManifest = readManifest(restoreDatabase);
  if (
    restoredManifest.schemaFingerprint !== expectedRestoredSchemaFingerprint
  ) {
    throw new DrillError("restored schema archive fingerprint");
  }
  compareRestoredManifest(sourceAfterDump, restoredManifest);
  verifyAccessBehavior(restoreDatabase);
  console.log("PASS: restored authorization behavior");
}

if (process.argv.length === 3 && process.argv[2] === "--self-test") {
  try {
    await runStaticSelfTest();
    console.log("PASS: local recovery drill static safety checks");
  } catch (error) {
    const stage =
      error instanceof DrillError
        ? error.stage
        : "static recovery drill safety";
    console.error(`FAIL: ${stage}`);
    process.exitCode = 1;
  }
} else {
  let failureStage = null;
  try {
    await performDrill();
  } catch (error) {
    failureStage =
      error instanceof DrillError ? error.stage : "local restore drill";
  } finally {
    const snapshotResult = await closeSnapshotExporter();
    if (!cleanup() || !snapshotResult.absent) failureStage = "cleanup";
  }

  if (failureStage) {
    console.error(`FAIL: ${failureStage}`);
    process.exitCode = 1;
  } else {
    console.log("PASS: temporary restore resources cleaned");
    console.log("PASS: synthetic local logical database restore drill");
    console.log(
      "CAVEAT: This is not production disaster recovery. Canonical Auth session and refresh tables are empty, so session recovery is not exercised; Storage object bytes and separate-cluster roles are not restored.",
    );
  }
}
