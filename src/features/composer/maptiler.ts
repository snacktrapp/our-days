import {
  parsePlaceCoordinates,
  trimmedPlaceLabel,
  type PlaceSelection,
} from "@/lib/place-coordinates";
import { MAPTILER_API_ORIGIN } from "@/lib/maptiler-origins";

const geocodeLimit = 5;

export type GeocodedPlace = PlaceSelection &
  Readonly<{
    latitude: number;
    longitude: number;
  }>;

type MapTilerFeature = Readonly<{
  place_name?: unknown;
  text?: unknown;
  center?: unknown;
}>;

type MapTilerGeocodeResponse = Readonly<{
  features?: readonly MapTilerFeature[];
}>;

export function publicMapTilerKey() {
  return process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
}

export function mapTilerStyleUrl(key: string) {
  return `${MAPTILER_API_ORIGIN}/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`;
}

const rasterTileZoom = 14;

function webMercatorTile(latitude: number, longitude: number, zoom: number) {
  const n = 2 ** zoom;
  const x = ((longitude + 180) / 360) * n;
  const latRad = (latitude * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function mapTilerRasterTile(
  key: string,
  latitude: number,
  longitude: number,
  zoom = rasterTileZoom,
) {
  if (!key) return null;
  const { x, y } = webMercatorTile(latitude, longitude, zoom);
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  return {
    url: `${MAPTILER_API_ORIGIN}/maps/streets-v2/256/${zoom}/${tileX}/${tileY}.png?key=${encodeURIComponent(key)}`,
    xFraction: x - tileX,
    yFraction: y - tileY,
  };
}

function featureLabel(feature: MapTilerFeature) {
  if (typeof feature.place_name === "string" && feature.place_name.trim()) {
    return trimmedPlaceLabel(feature.place_name);
  }
  if (typeof feature.text === "string" && feature.text.trim()) {
    return trimmedPlaceLabel(feature.text);
  }
  return "";
}

function featurePlace(feature: MapTilerFeature): GeocodedPlace | null {
  if (!Array.isArray(feature.center) || feature.center.length < 2) return null;
  const coordinates = parsePlaceCoordinates(
    feature.center[1],
    feature.center[0],
  );
  const label = featureLabel(feature);
  if (!coordinates || !label) return null;
  return { label, ...coordinates };
}

async function geocode(
  path: string,
  key: string,
  signal?: AbortSignal,
): Promise<readonly GeocodedPlace[]> {
  const url = new URL(`${MAPTILER_API_ORIGIN}/geocoding/${path}.json`);
  url.searchParams.set("key", key);
  url.searchParams.set("limit", String(geocodeLimit));
  const response = await fetch(url, {
    method: "GET",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as MapTilerGeocodeResponse;
  if (!Array.isArray(payload.features)) return [];
  return payload.features.flatMap((feature) => {
    const place = featurePlace(feature);
    return place ? [place] : [];
  });
}

export async function searchMapTilerPlaces(
  query: string,
  key: string,
  signal?: AbortSignal,
) {
  const trimmed = query.trim();
  if (!trimmed || !key) return [];
  return geocode(encodeURIComponent(trimmed), key, signal);
}

export async function reverseGeocodeMapTilerPlace(
  latitude: number,
  longitude: number,
  key: string,
  signal?: AbortSignal,
) {
  if (!key) return "";
  const [place] = await geocode(`${longitude},${latitude}`, key, signal);
  return place?.label ?? "";
}
