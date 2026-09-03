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
