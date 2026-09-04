import {
  mapTilerRasterTileUrl,
  parseMapTileIndex,
  serverMapTilerKey,
} from "@/features/composer/maptiler";
import { mapsApiHeaders, mapsApiText, mapTilerUpstreamInit } from "../response";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tile = parseMapTileIndex(
    url.searchParams.get("z"),
    url.searchParams.get("x"),
    url.searchParams.get("y"),
  );
  if (!tile) return mapsApiText(400, "invalid_tile");

  const key = serverMapTilerKey();
  const mapUrl = mapTilerRasterTileUrl(key, tile.z, tile.x, tile.y);
  if (!mapUrl) return mapsApiText(503, "maptiler_key_missing");

  let upstream: Response;
  try {
    upstream = await fetch(mapUrl, mapTilerUpstreamInit(request));
  } catch {
    return mapsApiText(502, "maptiler_upstream_failed");
  }
  if (!upstream.ok) {
    return mapsApiText(502, `maptiler_upstream_failed ${upstream.status}`);
  }

  const contentType = upstream.headers.get("content-type") ?? "image/png";
  if (contentType && !contentType.startsWith("image/")) {
    return mapsApiText(502, "maptiler_upstream_failed");
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
