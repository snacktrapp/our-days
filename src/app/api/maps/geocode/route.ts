import {
  reverseGeocodeMapTilerPlace,
  searchMapTilerPlaces,
  serverMapTilerKey,
} from "@/features/composer/maptiler";
import { parsePlaceCoordinates } from "@/lib/place-coordinates";
import { mapsApiHeaders, mapsApiText } from "../response";

export async function GET(request: Request) {
  const key = serverMapTilerKey();
  if (!key) return mapsApiText(503, "maptiler_key_missing");

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const coordinates = parsePlaceCoordinates(
    url.searchParams.get("lat"),
    url.searchParams.get("lng"),
  );

  try {
    if (query) {
      const places = await searchMapTilerPlaces(query, key);
      return Response.json(places, {
        headers: { ...mapsApiHeaders, "Cache-Control": "no-store" },
      });
    }
    if (coordinates) {
      const label = await reverseGeocodeMapTilerPlace(
        coordinates.latitude,
        coordinates.longitude,
        key,
      );
      return Response.json(
        { label },
        { headers: { ...mapsApiHeaders, "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return mapsApiText(502, "maptiler_upstream_failed");
  }

  return mapsApiText(400, "invalid_query");
}
