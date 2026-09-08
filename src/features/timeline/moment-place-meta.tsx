"use client";

import { useState } from "react";
import {
  parsePlaceCoordinates,
  shortPlaceLabel,
} from "@/lib/place-coordinates";
import { PlaceMapOverlay } from "./place-map-overlay";
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
  const [open, setOpen] = useState(false);
  const shortName = shortPlaceLabel(placeName);
  const coordinates = parsePlaceCoordinates(latitude, longitude);
  if (!coordinates || !shortName) return children;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={`Map of ${shortName}`}
      >
        {children}
      </button>
      {open ? (
        <PlaceMapOverlay
          place={shortName}
          latitude={coordinates.latitude}
          longitude={coordinates.longitude}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
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
  const [open, setOpen] = useState(false);
  const shortName = placeName ? shortPlaceLabel(placeName) : "";
  const coordinates = parsePlaceCoordinates(latitude, longitude);

  if (!shortName) {
    return (
      <p className={heading ? "moment-kicker" : "thought-label"}>{typeLabel}</p>
    );
  }

  const placeLine = coordinates ? (
    <button
      type="button"
      className="moment-place-line"
      onClick={() => setOpen(true)}
      aria-label={`Map of ${shortName}`}
    >
      <PlacePin />
      <span>{shortName}</span>
    </button>
  ) : (
    <span className="moment-place-line">
      <PlacePin />
      <span>{shortName}</span>
    </span>
  );

  return (
    <>
      <p className={`moment-kind-meta${heading ? " moment-kicker" : ""}`}>
        <span className="moment-kind-meta-type">{typeLabel}</span>
        <span aria-hidden="true"> · </span>
        {placeLine}
      </p>
      {open && coordinates ? (
        <PlaceMapOverlay
          place={shortName}
          latitude={coordinates.latitude}
          longitude={coordinates.longitude}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
