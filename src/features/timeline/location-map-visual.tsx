"use client";

import { useState } from "react";
import {
  publicMapTilerKey,
  staticMapImageSrc,
} from "@/features/composer/maptiler";
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
  const [failed, setFailed] = useState(false);
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  const mapUrl =
    coordinates && publicMapTilerKey()
      ? staticMapImageSrc(coordinates.latitude, coordinates.longitude)
      : "";
  const showLiveMap = Boolean(mapUrl) && !failed;

  return (
    <div
      className={`memory-map${showLiveMap ? " memory-map-live" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {showLiveMap ? (
        <>
          {/* Same-origin proxy fetches MapTiler Static Maps so a browser
              referrer restriction cannot replace a saved pin with the
              illustration. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt={`Map of ${place}`}
            width={800}
            height={330}
            decoding="async"
            onError={() => setFailed(true)}
          />
          <small className="map-attribution">
            © MapTiler © OpenStreetMap contributors
          </small>
        </>
      ) : (
        <>
          <span className="map-water" />
          <span className="map-road road-one" />
          <span className="map-road road-two" />
        </>
      )}
      <span
        className="place-pin"
        aria-hidden="true"
        style={
          showLiveMap
            ? {
                top: "50%",
                left: "50%",
              }
            : undefined
        }
      >
        <i />
      </span>
    </div>
  );
}
