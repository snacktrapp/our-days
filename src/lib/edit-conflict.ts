const revisionConflictCodes = new Set(["PT409", "40001", "409"]);

function readField(error: unknown, field: "code" | "message" | "status") {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[field];
}

/**
 * Optimistic edit conflicts. PostgREST maps SQLSTATE PT409 to HTTP 409 and
 * does not retry it. 40001 remains accepted so an older database still shows
 * the same recovery copy.
 */
export function isEditConflictError(
  error: unknown,
  httpStatus?: number,
): boolean {
  const code = readField(error, "code");
  const message = readField(error, "message");
  const status =
    httpStatus ??
    (typeof readField(error, "status") === "number"
      ? (readField(error, "status") as number)
      : undefined);
  if (typeof code === "string" && revisionConflictCodes.has(code)) return true;
  if (status !== 409) return false;
  // A bare HTTP 409 is this conflict. Coded 409s such as 23505 stay generic
  // unless the database message is the revision conflict itself.
  if (typeof code !== "string" || code === "") return true;
  return typeof message === "string" && /changed elsewhere/iu.test(message);
}
