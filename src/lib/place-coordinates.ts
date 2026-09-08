export type PlaceCoordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type PlaceSelection = Readonly<{
  label: string;
  latitude: number | null;
  longitude: number | null;
}>;

function asFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function emptyPlaceSelection(): PlaceSelection {
  return { label: "", latitude: null, longitude: null };
}

export function parsePlaceCoordinates(
  latitude: unknown,
  longitude: unknown,
): PlaceCoordinates | null {
  const lat = asFiniteNumber(latitude);
  const lng = asFiniteNumber(longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

export function coordinatesArePresent(latitude: unknown, longitude: unknown) {
  const latMissing =
    latitude === null || latitude === undefined || latitude === "";
  const lngMissing =
    longitude === null || longitude === undefined || longitude === "";
  return !(latMissing && lngMissing);
}

export function validPlaceCoordinates(latitude: unknown, longitude: unknown) {
  if (!coordinatesArePresent(latitude, longitude)) return true;
  return parsePlaceCoordinates(latitude, longitude) !== null;
}

export function trimmedPlaceLabel(value: string) {
  return value.trim().slice(0, 160);
}

/** First comma-separated segment so cards store “Sand Harbor”, not the full address. */
export function shortPlaceLabel(value: string) {
  const trimmed = trimmedPlaceLabel(value);
  if (!trimmed) return "";
  const comma = trimmed.indexOf(",");
  return comma > 0 ? trimmed.slice(0, comma).trim() : trimmed;
}

/** Apple Maps https works on iOS, and falls back on Android/desktop. */
export function buildAppleMapsUrl(
  placeName: string,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  if (!coordinates) return null;
  const query =
    shortPlaceLabel(placeName) ||
    `${coordinates.latitude},${coordinates.longitude}`;
  const lat = coordinates.latitude;
  const lng = coordinates.longitude;
  return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(query)}&z=12`;
}
