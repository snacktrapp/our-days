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

/** Same-origin geocode proxy the web composer uses (`/api/maps/geocode`). */
export async function searchPlaces(query: string, signal?: AbortSignal) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const response = await fetch(
    `${siteOrigin}/api/maps/geocode?${new URLSearchParams({ q: trimmed })}`,
    { signal, headers: { origin: siteOrigin } },
  );
  if (!response.ok) throw new Error("Place search isn’t available right now.");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string") return [];
    if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return [];
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

/** Reverse lookup used by “Use my location” (`/api/maps/geocode?lat&lng`). */
export async function reversePlace(latitude: number, longitude: number) {
  const response = await fetch(
    `${siteOrigin}/api/maps/geocode?${new URLSearchParams({
      lat: String(latitude),
      lng: String(longitude),
    })}`,
    { headers: { origin: siteOrigin } },
  );
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
