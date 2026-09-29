/**
 * PostgREST 14.x before 14.18 sometimes rejects a valid, freshly issued JWT
 * with 401 PGRST303 "JWT issued at future" on the first request after an idle
 * period (stale cached clock, PostgREST/postgrest#5196). The request never
 * reaches the database, so replaying it is safe, and the next attempt passes.
 */
const retryDelaysMs = [300, 900];

function urlOf(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function isJwtClockRejection(response: Response) {
  if (response.status !== 401) return false;
  if (response.headers.get("proxy-status")?.includes("PGRST303")) return true;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body?.code === "PGRST303";
  } catch {
    return false;
  }
}

export function createRetryingFetch(
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): typeof fetch {
  return async (input, init) => {
    // Resolve fetch per call so tests and polyfills that replace it still apply.
    let response = await globalThis.fetch(input, init);
    if (!urlOf(input).includes("/rest/v1/")) return response;
    for (const delay of retryDelaysMs) {
      if (!(await isJwtClockRejection(response))) return response;
      await sleep(delay);
      response = await globalThis.fetch(input, init);
    }
    return response;
  };
}
