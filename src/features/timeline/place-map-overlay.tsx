"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import { MapPickerFrame } from "@/features/composer/map-picker-frame";
import {
  lockOverlayChrome,
  unlockOverlayChrome,
} from "@/features/shell/overlay-chrome";

type PlaceMapOverlayProps = Readonly<{
  place: string;
  latitude: number;
  longitude: number;
  onClose: () => void;
}>;

export function PlaceMapOverlay({
  place,
  latitude,
  longitude,
  onClose,
}: PlaceMapOverlayProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mounted = useModalDialog(true, dialogRef);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "missing">(
    "loading",
  );

  useEffect(() => {
    lockOverlayChrome();
    return () => unlockOverlayChrome();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/maps/style", { signal: controller.signal })
      .then((response) => {
        setMapStatus(response.ok ? "ready" : "missing");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setMapStatus("missing");
      });
    return () => controller.abort();
  }, []);

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="place-map-dialog"
      aria-labelledby="place-map-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={containDialogFocus}
    >
      <div className="place-map-sheet">
        <header className="place-map-bar">
          <h2 id="place-map-title">{place}</h2>
          <button
            ref={closeRef}
            type="button"
            className="place-map-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        {mapStatus === "missing" ? (
          <p className="place-map-unavailable" role="status">
            Map isn’t available right now.
          </p>
        ) : null}
        {mapStatus === "ready" ? (
          <MapPickerFrame
            className="place-map-frame"
            latitude={latitude}
            longitude={longitude}
            title={`Map of ${place}`}
            interactive={false}
            onEscape={onClose}
          />
        ) : null}
        {mapStatus === "loading" ? (
          <p className="place-map-unavailable" role="status">
            Opening map…
          </p>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
