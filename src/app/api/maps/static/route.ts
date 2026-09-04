import { parsePlaceCoordinates } from "@/lib/place-coordinates";
import {
  mapTilerStaticMapUrl,
  serverMapTilerKey,
} from "@/features/composer/maptiler";
import { mapsApiHeaders, mapsApiText, mapTilerUpstreamInit } from "../response";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const coordinates = parsePlaceCoordinates(
    url.searchParams.get("lat"),
    url.searchParams.get("lng"),
  );
  if (!coordinates) return mapsApiText(400, "invalid_coordinates");

  const key = serverMapTilerKey();
  const mapUrl = mapTilerStaticMapUrl(
    key,
    coordinates.latitude,
    coordinates.longitude,
  );
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
