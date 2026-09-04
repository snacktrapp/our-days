"use client";

import { useState } from "react";
import { staticMapImageSrc } from "@/features/composer/maptiler";
import { parsePlaceCoordinates } from "@/lib/place-coordinates";

export function LocationMapVisual({
  place,
  latitude,
  longitude,
  className,
}: Readonly<{
  place: string;
  latitude?: number | null;
  longitude?: number | null;
  className?: string;
}>) {
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  const src = coordinates
    ? staticMapImageSrc(coordinates.latitude, coordinates.longitude)
    : "";
  const mapKey = coordinates
    ? `${coordinates.latitude},${coordinates.longitude}`
    : "illustration";

  return (
    <LocationMapFrame
      key={mapKey}
      place={place}
      className={className}
      src={src}
    />
  );
}

function LocationMapFrame({
  place,
  className,
  src,
}: Readonly<{
  place: string;
  className?: string;
  src: string;
}>) {
  const [failed, setFailed] = useState(false);
  const showLiveMap = Boolean(src) && !failed;

  return (
    <div
      className={`memory-map${showLiveMap ? " memory-map-live" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {showLiveMap ? (
        <>
          {/* Same-origin stitched PNG. SVG <image> tiles fail silently on
              iPhone Safari, which is why the phone still showed the
              illustration. Fail closed: no fake-road placeholder. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Map of ${place}`}
            width={800}
            height={330}
            onError={() => setFailed(true)}
          />
          <small className="map-attribution">
            © MapTiler © OpenStreetMap contributors
          </small>
        </>
      ) : null}
      <span className="place-pin" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}
