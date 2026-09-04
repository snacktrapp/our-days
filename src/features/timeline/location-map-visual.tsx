"use client";

import { useState } from "react";
import {
  MAP_TILE_SIZE,
  mapTileViewport,
  publicMapTilerKey,
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
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  const viewport = coordinates
    ? mapTileViewport(
        coordinates.latitude,
        coordinates.longitude,
        publicMapTilerKey(),
      )
    : null;
  const mapKey = coordinates
    ? `${coordinates.latitude},${coordinates.longitude}`
    : "illustration";

  return (
    <LocationMapFrame
      key={mapKey}
      place={place}
      className={className}
      viewport={viewport}
    />
  );
}

function LocationMapFrame({
  place,
  className,
  viewport,
}: Readonly<{
  place: string;
  className?: string;
  viewport: ReturnType<typeof mapTileViewport>;
}>) {
  const [failed, setFailed] = useState(false);
  const showLiveMap = Boolean(viewport?.tiles.length) && !failed;

  return (
    <div
      className={`memory-map${showLiveMap ? " memory-map-live" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {showLiveMap && viewport ? (
        <>
          <svg
            role="img"
            aria-label={`Map of ${place}`}
            viewBox={viewport.viewBox}
            preserveAspectRatio="xMidYMid slice"
            onErrorCapture={() => setFailed(true)}
          >
            {viewport.tiles.map((tile) => (
              <image
                key={`${tile.z}/${tile.x}/${tile.y}/${tile.originX}`}
                href={tile.href}
                x={tile.originX}
                y={tile.originY}
                width={MAP_TILE_SIZE}
                height={MAP_TILE_SIZE}
              />
            ))}
          </svg>
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
      <span className="place-pin" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}
