import { parsePlaceCoordinates } from "@/lib/place-coordinates";
import {
  mapTilerStaticMapUrl,
  serverMapTilerKey,
} from "@/features/composer/maptiler";

const headers = {
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function unavailable(status = 404) {
  return new Response(null, { status, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const coordinates = parsePlaceCoordinates(
    url.searchParams.get("lat"),
    url.searchParams.get("lng"),
  );
  if (!coordinates) return unavailable(400);

  const key = serverMapTilerKey();
  const mapUrl = mapTilerStaticMapUrl(
    key,
    coordinates.latitude,
    coordinates.longitude,
  );
  if (!mapUrl) return unavailable();

  let upstream: Response;
  try {
    upstream = await fetch(mapUrl, {
      method: "GET",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return unavailable();
  }
  if (!upstream.ok) return unavailable();

  const contentType = upstream.headers.get("content-type") ?? "image/png";
  if (contentType && !contentType.startsWith("image/")) return unavailable();

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
