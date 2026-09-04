export const MAP_PICKER_SOURCE = "our-days-map-picker";
export const MAP_PICKER_PATH = "/internal/map-picker";

export const DEFAULT_MAP_CENTER = {
  longitude: -96.6,
  latitude: 39.8,
  zoom: 3,
} as const;

export type MapPickerToParent =
  | Readonly<{ source: typeof MAP_PICKER_SOURCE; type: "ready" }>
  | Readonly<{
      source: typeof MAP_PICKER_SOURCE;
      type: "moved";
      latitude: number;
      longitude: number;
    }>
  | Readonly<{ source: typeof MAP_PICKER_SOURCE; type: "escape" }>;

export type ParentToMapPicker =
  | Readonly<{
      source: typeof MAP_PICKER_SOURCE;
      type: "init";
      latitude: number | null;
      longitude: number | null;
    }>
  | Readonly<{
      source: typeof MAP_PICKER_SOURCE;
      type: "set-place";
      latitude: number;
      longitude: number;
    }>;

export function isMapPickerToParent(
  value: unknown,
): value is MapPickerToParent {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<MapPickerToParent>;
  if (message.source !== MAP_PICKER_SOURCE) return false;
  return (
    message.type === "ready" ||
    message.type === "escape" ||
    (message.type === "moved" &&
      typeof message.latitude === "number" &&
      typeof message.longitude === "number")
  );
}

export function isParentToMapPicker(
  value: unknown,
): value is ParentToMapPicker {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ParentToMapPicker>;
  if (message.source !== MAP_PICKER_SOURCE) return false;
  if (message.type === "init") {
    return (
      (message.latitude === null || typeof message.latitude === "number") &&
      (message.longitude === null || typeof message.longitude === "number")
    );
  }
  return (
    message.type === "set-place" &&
    typeof message.latitude === "number" &&
    typeof message.longitude === "number"
  );
}
