"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map-picker.css";
import {
  DEFAULT_MAP_CENTER,
  MAP_PICKER_SOURCE,
  isParentToMapPicker,
  type MapPickerToParent,
} from "@/features/composer/map-picker-protocol";
import {
  mapTilerStyleProxySrc,
  mapTilerStyleUrl,
} from "@/features/composer/maptiler";
import { parsePlaceCoordinates } from "@/lib/place-coordinates";

export function MapPickerCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const parentOrigin = window.location.origin;
    let cancelled = false;
    let starting = false;
    let map: import("maplibre-gl").Map | undefined;
    let marker: import("maplibre-gl").Marker | undefined;
    let maplibre: typeof import("maplibre-gl") | undefined;
    let observer: ResizeObserver | null = null;

    const post = (message: MapPickerToParent) => {
      window.parent.postMessage(message, parentOrigin);
    };

    const placeMarker = (latitude: number, longitude: number) => {
      if (!map || !maplibre) return;
      if (!marker) {
        marker = new maplibre.Marker({ color: "#c9a227", draggable: true })
          .setLngLat([longitude, latitude])
          .addTo(map);
        marker.on("dragend", () => {
          const lngLat = marker?.getLngLat();
          if (!lngLat) return;
          post({
            source: MAP_PICKER_SOURCE,
            type: "moved",
            latitude: lngLat.lat,
            longitude: lngLat.lng,
          });
        });
      } else {
        marker.setLngLat([longitude, latitude]);
      }
      const nextZoom = Math.max(map.getZoom(), 12);
      map.easeTo({ center: [longitude, latitude], zoom: nextZoom });
    };

    const startMap = async (
      key: string,
      latitude: number | null,
      longitude: number | null,
    ) => {
      if (cancelled || map || starting) return;
      starting = true;
      maplibre = await import("maplibre-gl");
      if (cancelled || !container) return;
      map = new maplibre.Map({
        container,
        style: key ? mapTilerStyleUrl(key) : mapTilerStyleProxySrc,
        center: [DEFAULT_MAP_CENTER.longitude, DEFAULT_MAP_CENTER.latitude],
        zoom: DEFAULT_MAP_CENTER.zoom,
        attributionControl: { compact: true },
      });
      map.on("click", (event) => {
        placeMarker(event.lngLat.lat, event.lngLat.lng);
        post({
          source: MAP_PICKER_SOURCE,
          type: "moved",
          latitude: event.lngLat.lat,
          longitude: event.lngLat.lng,
        });
      });
      const coordinates = parsePlaceCoordinates(latitude, longitude);
      const resize = () => map?.resize();
      map.on("load", () => {
        resize();
        if (coordinates)
          placeMarker(coordinates.latitude, coordinates.longitude);
      });
      observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(resize);
      observer?.observe(container);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== parentOrigin) return;
      if (!isParentToMapPicker(event.data)) return;
      if (event.data.type === "init") {
        void startMap(
          event.data.key,
          event.data.latitude,
          event.data.longitude,
        );
        return;
      }
      placeMarker(event.data.latitude, event.data.longitude);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        post({ source: MAP_PICKER_SOURCE, type: "escape" });
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    post({ source: MAP_PICKER_SOURCE, type: "ready" });

    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
      marker?.remove();
      map?.remove();
      observer?.disconnect();
    };
  }, []);

  return <div ref={containerRef} className="map-picker-canvas" />;
}
