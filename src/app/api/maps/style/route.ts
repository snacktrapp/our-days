import {
  mapTilerStyleUrl,
  rewriteMapTilerStyleDocument,
  serverMapTilerKey,
} from "@/features/composer/maptiler";
import { mapsApiHeaders, mapsApiText, mapTilerUpstreamInit } from "../response";

export async function GET(request: Request) {
  const key = serverMapTilerKey();
  if (!key) return mapsApiText(503, "maptiler_key_missing");

  let upstream: Response;
  try {
    upstream = await fetch(
      mapTilerStyleUrl(key),
      mapTilerUpstreamInit(request),
    );
  } catch {
    return mapsApiText(502, "maptiler_upstream_failed");
  }
  if (!upstream.ok) {
    return mapsApiText(502, `maptiler_upstream_failed ${upstream.status}`);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return mapsApiText(502, "maptiler_upstream_failed");
  }

  return Response.json(rewriteMapTilerStyleDocument(payload), {
    headers: {
      ...mapsApiHeaders,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
