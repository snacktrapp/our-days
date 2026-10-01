import { siteOrigin } from "./config";

export type GeocodedPlace = Readonly<{
  label: string;
  detail?: string;
  latitude: number;
  longitude: number;
}>;

export type PlaceSelection = Readonly<{
  label: string;
  latitude: number | null;
  longitude: number | null;
}>;

export const emptyPlace: PlaceSelection = {
  label: "",
  latitude: null,
  longitude: null,
};

/** "35.1276, -120.6308" — never a place name we should show or search. */
const coordinateLabelPattern = /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/u;

export function looksLikeCoordinates(value: string) {
  return coordinateLabelPattern.test(value.trim());
}

type DeviceAddress = Readonly<{
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  name?: string | null;
}>;

function cleanPlacePart(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || looksLikeCoordinates(trimmed)) return "";
  return trimmed;
}

/**
 * Short place name from the on-device geocoder. City first, matching the
 * web composer’s “Morro Bay” label rather than a street or full address.
 */
export function labelFromDeviceAddress(address: DeviceAddress) {
  return (
    cleanPlacePart(address.city) ||
    cleanPlacePart(address.district) ||
    cleanPlacePart(address.subregion) ||
    cleanPlacePart(address.name) ||
    cleanPlacePart(address.region) ||
    ""
  );
}

function readPlaceLabel(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("label" in payload)) return "";
  const label = payload.label;
  if (typeof label !== "string") return "";
  const trimmed = label.trim();
  return looksLikeCoordinates(trimmed) ? "" : trimmed;
}

/**
 * Same geocode proxy the web composer uses (`/api/maps/geocode?q=`).
 * The MapTiler key stays on the server; this client sends no key and no
 * extra auth header.
 */
export async function searchPlaces(query: string, signal?: AbortSignal) {
  const trimmed = query.trim();
  if (!trimmed || looksLikeCoordinates(trimmed)) return [];
  const response = await fetch(
    `${siteOrigin}/api/maps/geocode?${new URLSearchParams({ q: trimmed })}`,
    { signal },
  );
  if (!response.ok) throw new Error("place_search_failed");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string") return [];
    if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return [];
    if (looksLikeCoordinates(row.label)) return [];
    return [
      {
        label: row.label,
        detail: typeof row.detail === "string" ? row.detail : undefined,
        latitude: row.latitude,
        longitude: row.longitude,
      },
    ];
  });
}

async function reversePlaceFromServer(latitude: number, longitude: number) {
  try {
    const response = await fetch(
      `${siteOrigin}/api/maps/geocode?${new URLSearchParams({
        lat: String(latitude),
        lng: String(longitude),
      })}`,
    );
    if (!response.ok) return "";
    return readPlaceLabel(await response.json());
  } catch {
    return "";
  }
}

/**
 * expo-location’s CLGeocoder / Android geocoder. Already in the 0.5.0
 * binary. The web build throws; callers treat that as “no name”.
 */
async function reversePlaceFromDevice(latitude: number, longitude: number) {
  try {
    const Location = await import("expo-location");
    if (typeof Location.reverseGeocodeAsync !== "function") return "";
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const first = results[0];
    if (!first) return "";
    return labelFromDeviceAddress(first);
  } catch {
    return "";
  }
}

/**
 * Reverse lookup for “Use my location”.
 *
 * Tries the same server route the web uses (`/api/maps/geocode?lat&lng`).
 * That route currently returns 502 for every coordinate query: the proxy
 * always sends MapTiler `limit=5`, and MapTiler rejects reverse geocoding
 * when limit is greater than 1 unless a single `types` filter is set.
 * Text search (`?q=Morro Bay`) is unaffected. Until that server limit is
 * fixed, fall back to the on-device geocoder. Never return raw coordinates.
 */
export async function reversePlace(latitude: number, longitude: number) {
  const named = await reversePlaceFromServer(latitude, longitude);
  if (named) return named;
  return reversePlaceFromDevice(latitude, longitude);
}
