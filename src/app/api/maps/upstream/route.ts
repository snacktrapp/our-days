import {
  allowedMapTilerUrl,
  rewriteMapTilerStyleDocument,
  serverMapTilerKey,
} from "@/features/composer/maptiler";
import { mapsApiHeaders, mapsApiText, mapTilerUpstreamInit } from "../response";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("u")?.trim() ?? "";
  const target = allowedMapTilerUrl(requested);
  if (!target) return mapsApiText(400, "invalid_upstream");

  const key = serverMapTilerKey();
  if (!key) return mapsApiText(503, "maptiler_key_missing");

  target.searchParams.delete("key");
  target.searchParams.set("key", key);

  let upstream: Response;
  try {
    upstream = await fetch(target, mapTilerUpstreamInit(request));
  } catch {
    return mapsApiText(502, "maptiler_upstream_failed");
  }
  if (!upstream.ok) {
    return mapsApiText(502, `maptiler_upstream_failed ${upstream.status}`);
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  if (contentType.includes("json")) {
    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return mapsApiText(502, "maptiler_upstream_failed");
    }
    return Response.json(rewriteMapTilerStyleDocument(payload), {
      headers: {
        ...mapsApiHeaders,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...mapsApiHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
