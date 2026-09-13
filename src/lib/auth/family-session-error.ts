const fatalJournalHomeMessages = new Set([
  "Circle is unavailable",
  "Member profile is unavailable",
  "Circle date is unavailable",
  "Timeline request is too large",
  "Timeline snapshot is invalid",
]);

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function errorName(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function errorDigest(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" ? digest : "";
}

export function isNextControlFlowError(error: unknown) {
  return (
    /^NEXT_/u.test(errorDigest(error)) || /^NEXT_/u.test(errorMessage(error))
  );
}

export function isFatalJournalHomeError(error: unknown) {
  if (isNextControlFlowError(error)) return true;
  return fatalJournalHomeMessages.has(errorMessage(error));
}

export function isRecoverableJournalNavigationError(error: unknown) {
  const name = errorName(error);
  const message = errorMessage(error);
  const digest = errorDigest(error);
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    digest.includes("ABORT") ||
    /aborted|abort|cancelled|canceled|navigation/iu.test(message)
  );
}

export function isTransientFamilySessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = errorCode(error);
  const message = errorMessage(error);
  const status = errorStatus(error);
  return (
    isRecoverableJournalNavigationError(error) ||
    code === "PGRST301" ||
    code === "08000" ||
    code === "08003" ||
    code === "08006" ||
    code === "57014" ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /jwt expired|fetch failed|failed to fetch|network|timeout|econnreset|socket/iu.test(
      message,
    )
  );
}
