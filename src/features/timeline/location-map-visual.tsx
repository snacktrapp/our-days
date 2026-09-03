"use client";

import { useState } from "react";
import {
  mapTilerRasterTile,
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
  const tile =
    latitude != null && longitude != null
      ? mapTilerRasterTile(publicMapTilerKey(), latitude, longitude)
      : null;
  const showLiveMap = Boolean(tile) && !failed;

  return (
    <div
      className={`memory-map${showLiveMap ? " memory-map-live" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {showLiveMap && tile ? (
        <>
          {/* MapTiler raster tiles are allowlisted on img-src. The document
              referrer policy is no-referrer; origin is required for this key. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tile.url}
            alt={`Map of ${place}`}
            width={256}
            height={256}
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
          showLiveMap && tile
            ? {
                top: `${tile.yFraction * 100}%`,
                left: `${tile.xFraction * 100}%`,
              }
            : undefined
        }
      >
        <i />
      </span>
    </div>
  );
}
