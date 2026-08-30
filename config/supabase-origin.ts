const hostedProjectPattern = /^([a-z0-9]{20})\.supabase\.co$/u;

export type SupabaseOriginErrorCode =
  "invalid-url" | "not-base-origin" | "unsupported-origin";

export class SupabaseOriginError extends Error {
  readonly code: SupabaseOriginErrorCode;

  constructor(code: SupabaseOriginErrorCode) {
    super("The Supabase URL is not an approved project origin.");
    this.name = "SupabaseOriginError";
    this.code = code;
  }
}

export type ResolvedSupabaseOrigin = Readonly<{
  http: string;
  websocket: string;
  projectRef: "local" | string;
  local: boolean;
}>;

export function resolveSupabaseOrigin(value: string): ResolvedSupabaseOrigin {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SupabaseOriginError("invalid-url");
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.hostname.includes("*") ||
    parsed.hostname.endsWith(".") ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new SupabaseOriginError("not-base-origin");
  }

  const local =
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".localhost") ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  const hostedMatch = hostedProjectPattern.exec(parsed.hostname);
  if (local) {
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new SupabaseOriginError("unsupported-origin");
    }
  } else if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    !hostedMatch
  ) {
    throw new SupabaseOriginError("unsupported-origin");
  }

  return {
    http: parsed.origin,
    websocket: `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`,
    projectRef: local ? "local" : hostedMatch![1],
    local,
  };
}
