// The uploader and status shelf can ask to finish the same intake at once.
// Share only in-flight work; subsequent polls must still be able to retry.
const pending = new Map<string, Promise<Response>>();

export async function requestPhotoProcessingResponse(
  intakeId: string,
  signal?: AbortSignal,
): Promise<Response> {
  let request = pending.get(intakeId);
  if (!request) {
    request = globalThis.fetch("/api/photos/process", {
      body: JSON.stringify({ intakeId }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });
    pending.set(intakeId, request);
  }
  try {
    // Each caller owns its response body (including a terminal 409 message).
    return (await request).clone();
  } finally {
    if (pending.get(intakeId) === request) pending.delete(intakeId);
  }
}
