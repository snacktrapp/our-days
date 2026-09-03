"use client";

import { useEffect, useState } from "react";
import {
  staticMapImageSrc,
  staticMapProxySrc,
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
  const [useProxy, setUseProxy] = useState(false);
  const coordinates = parsePlaceCoordinates(latitude, longitude);

  useEffect(() => {
    setFailed(false);
    setUseProxy(false);
  }, [latitude, longitude]);
  const directUrl = coordinates
    ? staticMapImageSrc(coordinates.latitude, coordinates.longitude)
    : "";
  const proxyUrl = coordinates
    ? staticMapProxySrc(coordinates.latitude, coordinates.longitude)
    : "";
  const mapUrl = useProxy && proxyUrl && proxyUrl !== directUrl ? proxyUrl : directUrl;
  const showLiveMap = Boolean(mapUrl) && !failed;

  return (
    <div
      className={`memory-map${showLiveMap ? " memory-map-live" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {showLiveMap ? (
        <>
          {/* Prefer a direct MapTiler image with no referrer — the same
              policy that already makes place search work on iPhone. The
              same-origin proxy is only a fallback if that image errors. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt={`Map of ${place}`}
            width={800}
            height={330}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!useProxy && proxyUrl && proxyUrl !== mapUrl) {
                setUseProxy(true);
                return;
              }
              setFailed(true);
            }}
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