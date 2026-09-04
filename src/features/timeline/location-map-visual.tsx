"use client";

type LocationMapVisualProps = Readonly<{
  place: string;
  latitude?: number | null;
  longitude?: number | null;
  className?: string;
}>;

/**
 * Ship: do not paint MapTiler / placeholder map chrome. Saved location
 * moments stay readable from the card title and body.
 */
export function LocationMapVisual(props: LocationMapVisualProps) {
  void props;
  return null;
}
