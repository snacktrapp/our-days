import {
  parsePlaceCoordinates,
  trimmedPlaceLabel,
  type PlaceSelection,
} from "@/lib/place-coordinates";
import {
  MAPTILER_API_ORIGIN,
  MAPTILER_CDN_ORIGIN,
} from "@/lib/maptiler-origins";

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
  geometry?: unknown;
  properties?: unknown;
}>;

export class MapTilerGeocodeError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("maptiler_geocode_failed");
    this.name = "MapTilerGeocodeError";
    this.status = status;
  }
}

type MapTilerGeocodeResponse = Readonly<{
  features?: readonly MapTilerFeature[];
}>;

const serverMapTilerKeyNames = [
  "NEXT_PUBLIC_MAPTILER_KEY",
  "MAPTILER_KEY",
  "MAPTILER_API_KEY",
] as const;

export function publicMapTilerKey() {
  return process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
}

export function serverMapTilerKey() {
  // Bracket access keeps the server route reading Vercel's runtime env even
  // when NEXT_PUBLIC_MAPTILER_KEY was empty at build time and got inlined.
  for (const name of serverMapTilerKeyNames) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return publicMapTilerKey();
}

export const mapTilerStyleProxySrc = "/api/maps/style";

export const MAP_TILE_SIZE = 256;
export const STATIC_MAP_VIEW = {
  width: 800,
  height: 330,
  zoom: 14,
} as const;

export type MapTileCell = Readonly<{
  z: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  href: string;
}>;

export type MapTileViewport = Readonly<{
  tiles: readonly MapTileCell[];
  left: number;
  top: number;
  width: number;
  height: number;
  viewBox: string;
}>;

export function mapTilerStyleUrl(key: string) {
  return `${MAPTILER_API_ORIGIN}/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`;
}

export function allowedMapTilerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.origin === MAPTILER_API_ORIGIN ||
      url.origin === MAPTILER_CDN_ORIGIN
    ) {
      return url;
    }
  } catch {
    return null;
  }
  return null;
}

export function mapTilerUpstreamProxySrc(url: URL) {
  const clean = new URL(url.toString());
  clean.searchParams.delete("key");
  return `/api/maps/upstream?${new URLSearchParams({ u: clean.toString() })}`;
}

export function rewriteMapTilerStyleDocument(value: unknown): unknown {
  if (typeof value === "string") {
    const url = allowedMapTilerUrl(value);
    return url ? mapTilerUpstreamProxySrc(url) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteMapTilerStyleDocument(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewriteMapTilerStyleDocument(entry),
      ]),
    );
  }
  return value;
}

function mapTilerFetchInit(
  request?: Request,
  signal?: AbortSignal,
): RequestInit {
  const origin = request ? new URL(request.url).origin : "";
  return {
    method: "GET",
    referrer: origin ? `${origin}/` : undefined,
    referrerPolicy: origin ? "origin" : "no-referrer",
    headers: origin ? { Referer: `${origin}/`, Origin: origin } : undefined,
    signal,
  };
}

export function mapTilerRasterTileUrl(
  key: string,
  z: number,
  x: number,
  y: number,
) {
  if (!key) return "";
  return `${MAPTILER_API_ORIGIN}/maps/streets-v2/256/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}`;
}

export function mapTilerRasterTileProxySrc(z: number, x: number, y: number) {
  return `/api/maps/tile?${new URLSearchParams({
    z: String(z),
    x: String(x),
    y: String(y),
  })}`;
}

export function parseMapTileIndex(
  z: unknown,
  x: unknown,
  y: unknown,
): { z: number; x: number; y: number } | null {
  if (z == null || x == null || y == null || z === "" || x === "" || y === "") {
    return null;
  }
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22) return null;
  const max = 2 ** zoom;
  if (!Number.isInteger(tileX) || tileX < 0 || tileX >= max) return null;
  if (!Number.isInteger(tileY) || tileY < 0 || tileY >= max) return null;
  return { z: zoom, x: tileX, y: tileY };
}

export function lngLatToWorldPixel(
  longitude: number,
  latitude: number,
  zoom: number,
  tileSize = MAP_TILE_SIZE,
) {
  const n = 2 ** zoom;
  const x = ((longitude + 180) / 360) * n * tileSize;
  const clamped = Math.min(85.05112878, Math.max(-85.05112878, latitude));
  const sinLat = Math.sin((clamped * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
    n *
    tileSize;
  return { x, y };
}

export function mapTileViewport(
  latitude: number,
  longitude: number,
  key = publicMapTilerKey(),
  view: Readonly<{
    width: number;
    height: number;
    zoom: number;
  }> = STATIC_MAP_VIEW,
): MapTileViewport | null {
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  if (!coordinates) return null;
  const { x: cx, y: cy } = lngLatToWorldPixel(
    coordinates.longitude,
    coordinates.latitude,
    view.zoom,
  );
  const left = cx - view.width / 2;
  const top = cy - view.height / 2;
  const maxTile = 2 ** view.zoom;
  const minTx = Math.floor(left / MAP_TILE_SIZE);
  const maxTx = Math.floor((left + view.width - 1) / MAP_TILE_SIZE);
  const minTy = Math.floor(top / MAP_TILE_SIZE);
  const maxTy = Math.floor((top + view.height - 1) / MAP_TILE_SIZE);
  const tiles: MapTileCell[] = [];
  for (let ty = minTy; ty <= maxTy; ty++) {
    if (ty < 0 || ty >= maxTile) continue;
    for (let tx = minTx; tx <= maxTx; tx++) {
      const x = ((tx % maxTile) + maxTile) % maxTile;
      const href = key
        ? mapTilerRasterTileUrl(key, view.zoom, x, ty)
        : mapTilerRasterTileProxySrc(view.zoom, x, ty);
      tiles.push({
        z: view.zoom,
        x,
        y: ty,
        originX: tx * MAP_TILE_SIZE,
        originY: ty * MAP_TILE_SIZE,
        href,
      });
    }
  }
  return {
    tiles,
    left,
    top,
    width: view.width,
    height: view.height,
    viewBox: `${left} ${top} ${view.width} ${view.height}`,
  };
}

export function mapTilerStaticMapUrl(
  key: string,
  latitude: number,
  longitude: number,
  size: Readonly<{ width: number; height: number }> = {
    width: STATIC_MAP_VIEW.width,
    height: STATIC_MAP_VIEW.height,
  },
) {
  if (!key) return "";
  return `${MAPTILER_API_ORIGIN}/maps/streets-v2/static/${longitude},${latitude},${STATIC_MAP_VIEW.zoom}/${size.width}x${size.height}.png?key=${encodeURIComponent(key)}`;
}

export function staticMapProxySrc(latitude: number, longitude: number) {
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  if (!coordinates) return "";
  const params = new URLSearchParams({
    lat: String(coordinates.latitude),
    lng: String(coordinates.longitude),
  });
  return `/api/maps/static?${params}`;
}

export function staticMapImageSrc(latitude: number, longitude: number) {
  return staticMapProxySrc(latitude, longitude);
}

function propertyString(properties: unknown, name: string) {
  if (!properties || typeof properties !== "object") return "";
  const value = (properties as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

function featureLabel(feature: MapTilerFeature) {
  if (typeof feature.place_name === "string" && feature.place_name.trim()) {
    return trimmedPlaceLabel(feature.place_name);
  }
  if (typeof feature.text === "string" && feature.text.trim()) {
    return trimmedPlaceLabel(feature.text);
  }
  const named = propertyString(feature.properties, "name");
  if (named) return trimmedPlaceLabel(named);
  const labeled = propertyString(feature.properties, "label");
  return labeled ? trimmedPlaceLabel(labeled) : "";
}

function featureCoordinates(feature: MapTilerFeature) {
  if (Array.isArray(feature.center) && feature.center.length >= 2) {
    return parsePlaceCoordinates(feature.center[1], feature.center[0]);
  }
  if (
    feature.geometry &&
    typeof feature.geometry === "object" &&
    "coordinates" in feature.geometry &&
    Array.isArray(feature.geometry.coordinates) &&
    feature.geometry.coordinates.length >= 2
  ) {
    return parsePlaceCoordinates(
      feature.geometry.coordinates[1],
      feature.geometry.coordinates[0],
    );
  }
  return null;
}

function featurePlace(feature: MapTilerFeature): GeocodedPlace | null {
  const coordinates = featureCoordinates(feature);
  const label = featureLabel(feature);
  if (!coordinates || !label) return null;
  return { label, ...coordinates };
}

async function geocode(
  path: string,
  key: string,
  signal?: AbortSignal,
  request?: Request,
): Promise<readonly GeocodedPlace[]> {
  const url = new URL(`${MAPTILER_API_ORIGIN}/geocoding/${path}.json`);
  url.searchParams.set("key", key);
  url.searchParams.set("limit", String(geocodeLimit));
  const response = await fetch(url, mapTilerFetchInit(request, signal));
  if (!response.ok) throw new MapTilerGeocodeError(response.status);
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
  request?: Request,
) {
  const trimmed = query.trim();
  if (!trimmed || !key) return [];
  return geocode(encodeURIComponent(trimmed), key, signal, request);
}

export async function reverseGeocodeMapTilerPlace(
  latitude: number,
  longitude: number,
  key: string,
  signal?: AbortSignal,
  request?: Request,
) {
  if (!key) return "";
  const [place] = await geocode(
    `${longitude},${latitude}`,
    key,
    signal,
    request,
  );
  return place?.label ?? "";
}

export async function searchPlacesForComposer(
  query: string,
  signal?: AbortSignal,
): Promise<readonly GeocodedPlace[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const response = await fetch(
    `/api/maps/geocode?${new URLSearchParams({ q: trimmed })}`,
    { signal },
  );
  if (!response.ok) throw new MapTilerGeocodeError(response.status);
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as readonly GeocodedPlace[]) : [];
}

export async function reverseGeocodeForComposer(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
  });
  const response = await fetch(`/api/maps/geocode?${params}`, { signal });
  if (!response.ok) return "";
  const payload: unknown = await response.json();
  if (
    payload &&
    typeof payload === "object" &&
    "label" in payload &&
    typeof payload.label === "string"
  ) {
    return payload.label;
  }
  return "";
}
