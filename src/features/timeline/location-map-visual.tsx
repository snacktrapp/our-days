"use client";

import { useState } from "react";
import {
  mapTilerStaticMapUrl,
  publicMapTilerKey,
} from "@/features/composer/maptiler";

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
  const mapUrl =
    latitude != null && longitude != null
      ? mapTilerStaticMapUrl(publicMapTilerKey(), latitude, longitude)
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
          {/* MapTiler Static Maps are allowlisted on img-src. The document
              referrer policy is no-referrer; origin is required for this key. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt={`Map of ${place}`}
            width={800}
            height={330}
            decoding="async"
            referrerPolicy="origin"
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
