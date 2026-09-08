import {
  parsePlaceCoordinates,
  shortPlaceLabel,
  systemMapsHref,
} from "@/lib/place-coordinates";
import { PlacePin } from "./place-pin";

export function MomentPlaceButton({
  placeName,
  latitude,
  longitude,
  className,
  children,
}: Readonly<{
  placeName: string;
  latitude?: number | null;
  longitude?: number | null;
  className?: string;
  children: React.ReactNode;
}>) {
  const shortName = shortPlaceLabel(placeName);
  const href = systemMapsHref(placeName, latitude, longitude);
  if (!href || !shortName) return children;
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${shortName} in Maps`}
    >
      {children}
    </a>
  );
}

export function MomentPlaceMeta({
  typeLabel,
  placeName,
  latitude,
  longitude,
  heading = false,
}: Readonly<{
  typeLabel: string;
  placeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  heading?: boolean;
}>) {
  const shortName = placeName ? shortPlaceLabel(placeName) : "";
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  const href = systemMapsHref(placeName ?? "", latitude, longitude);

  if (!shortName) {
    return (
      <p className={heading ? "moment-kicker" : "thought-label"}>{typeLabel}</p>
    );
  }

  const placeLine =
    href && coordinates ? (
      <a
        className="moment-place-line"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${shortName} in Maps`}
      >
        <PlacePin />
        <span>{shortName}</span>
      </a>
    ) : (
      <span className="moment-place-line">
        <PlacePin />
        <span>{shortName}</span>
      </span>
    );

  return (
    <p className={`moment-kind-meta${heading ? " moment-kicker" : ""}`}>
      <span className="moment-kind-meta-type">{typeLabel}</span>
      <span aria-hidden="true"> · </span>
      {placeLine}
    </p>
  );
}
