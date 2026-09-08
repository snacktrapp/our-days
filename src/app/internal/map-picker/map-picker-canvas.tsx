"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map-picker.css";
import {
  DEFAULT_MAP_CENTER,
  MAP_PICKER_SOURCE,
  VIEW_MAP_ZOOM,
  isParentToMapPicker,
  type MapPickerToParent,
} from "@/features/composer/map-picker-protocol";
import { mapTilerStyleProxySrc } from "@/features/composer/maptiler";
import { parsePlaceCoordinates } from "@/lib/place-coordinates";

export function MapPickerCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const parentOrigin = window.location.origin;
    let cancelled = false;
    let starting = false;
    let interactive = true;
    let map: import("maplibre-gl").Map | undefined;
    let marker: import("maplibre-gl").Marker | undefined;
    let maplibre: typeof import("maplibre-gl") | undefined;
    let observer: ResizeObserver | null = null;

    const post = (message: MapPickerToParent) => {
      window.parent.postMessage(message, parentOrigin);
    };

    const resize = () => {
      const viewport = window.visualViewport;
      const width = Math.round(viewport?.width ?? window.innerWidth);
      const height = Math.round(viewport?.height ?? window.innerHeight);
      if (width > 0) container.style.width = `${width}px`;
      if (height > 0) container.style.height = `${height}px`;
      map?.resize();
    };

    const placeMarker = (latitude: number, longitude: number) => {
      if (!map || !maplibre) return;
      if (!marker) {
        marker = new maplibre.Marker({
          color: "#c9a227",
          draggable: interactive,
        })
          .setLngLat([longitude, latitude])
          .addTo(map);
        if (interactive) {
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
        }
      } else {
        marker.setLngLat([longitude, latitude]);
      }
      const nextZoom = interactive
        ? Math.max(map.getZoom(), 12)
        : Math.max(map.getZoom(), VIEW_MAP_ZOOM);
      map.easeTo({ center: [longitude, latitude], zoom: nextZoom });
    };

    const startMap = async (
      latitude: number | null,
      longitude: number | null,
    ) => {
      if (cancelled || map || starting) return;
      starting = true;
      maplibre = await import("maplibre-gl");
      if (cancelled || !container) return;
      resize();
      map = new maplibre.Map({
        container,
        style: mapTilerStyleProxySrc,
        center: [DEFAULT_MAP_CENTER.longitude, DEFAULT_MAP_CENTER.latitude],
        zoom: interactive ? DEFAULT_MAP_CENTER.zoom : VIEW_MAP_ZOOM,
        attributionControl: { compact: true },
        fadeDuration: 0,
        pitchWithRotate: false,
        dragRotate: interactive,
        touchPitch: false,
        cooperativeGestures: false,
        trackResize: true,
      });
      if (interactive) {
        map.on("click", (event) => {
          placeMarker(event.lngLat.lat, event.lngLat.lng);
          post({
            source: MAP_PICKER_SOURCE,
            type: "moved",
            latitude: event.lngLat.lat,
            longitude: event.lngLat.lng,
          });
        });
      }
      const coordinates = parsePlaceCoordinates(latitude, longitude);
      const settle = () => {
        resize();
        window.requestAnimationFrame(resize);
      };
      map.on("load", () => {
        settle();
        if (coordinates)
          placeMarker(coordinates.latitude, coordinates.longitude);
      });
      map.on("idle", settle);
      observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(resize);
      observer?.observe(container);
      window.visualViewport?.addEventListener("resize", resize);
      window.addEventListener("resize", resize);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== parentOrigin) return;
      if (!isParentToMapPicker(event.data)) return;
      if (event.data.type === "init") {
        interactive = event.data.interactive !== false;
        void startMap(event.data.latitude, event.data.longitude);
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
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      marker?.remove();
      map?.remove();
      observer?.disconnect();
    };
  }, []);

  return <div ref={containerRef} className="map-picker-canvas" />;
}
