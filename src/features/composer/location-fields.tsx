"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAP_PICKER_PATH,
  MAP_PICKER_SOURCE,
  isMapPickerToParent,
  type ParentToMapPicker,
} from "./map-picker-protocol";
import {
  publicMapTilerKey,
  reverseGeocodeMapTilerPlace,
  searchMapTilerPlaces,
  type GeocodedPlace,
} from "./maptiler";
import { ComposerPickerPanel } from "./composer-picker-panel";
import {
  emptyPlaceSelection,
  type PlaceSelection,
} from "@/lib/place-coordinates";

type LocationFieldsProps = Readonly<{
  value: PlaceSelection;
  required?: boolean;
  optional?: boolean;
  invalid?: boolean;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onChange: (value: PlaceSelection) => void;
}>;

function placeTriggerLabel(value: PlaceSelection) {
  return value.label.trim() || "Add a place";
}

function postToMap(
  iframe: HTMLIFrameElement | null,
  message: ParentToMapPicker,
) {
  iframe?.contentWindow?.postMessage(message, window.location.origin);
}

export function LocationFields({
  value,
  required = false,
  optional = false,
  invalid = false,
  searchInputRef,
  onChange,
}: LocationFieldsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mapReadyRef = useRef(false);
  const searchRequestRef = useRef(0);
  const valueRef = useRef(value);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value.label);
  const [suggestions, setSuggestions] = useState<readonly GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const mapKey = publicMapTilerKey();
  const mapAvailable = mapKey.length > 0;
  const canGeolocate =
    mapAvailable &&
    typeof navigator !== "undefined" &&
    "geolocation" in navigator;
  const panelOpen = open || invalid;

  const applyMapMove = useCallback(
    async (latitude: number, longitude: number) => {
      let label = valueRef.current.label.trim();
      if (mapKey) {
        try {
          const reversed = await reverseGeocodeMapTilerPlace(
            latitude,
            longitude,
            mapKey,
          );
          if (reversed) label = reversed;
        } catch {
          // Keep the label the family already typed.
        }
      }
      const nextLabel =
        label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      onChange({
        label: nextLabel,
        latitude,
        longitude,
      });
      setSearch(nextLabel);
      setLocationMessage(null);
    },
    [mapKey, onChange],
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!invalid) return;
    searchInputRef?.current?.focus();
  }, [invalid, searchInputRef]);

  useEffect(() => {
    if (!panelOpen) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen || !mapAvailable) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isMapPickerToParent(event.data)) return;
      if (event.data.type === "ready") {
        mapReadyRef.current = true;
        postToMap(iframeRef.current, {
          source: MAP_PICKER_SOURCE,
          type: "init",
          key: mapKey,
          latitude: valueRef.current.latitude,
          longitude: valueRef.current.longitude,
        });
        return;
      }
      if (event.data.type === "escape") {
        setOpen(false);
        return;
      }
      void applyMapMove(event.data.latitude, event.data.longitude);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyMapMove, mapAvailable, mapKey, panelOpen]);

  useEffect(() => {
    if (!panelOpen || !mapReadyRef.current) return;
    if (value.latitude === null || value.longitude === null) return;
    postToMap(iframeRef.current, {
      source: MAP_PICKER_SOURCE,
      type: "set-place",
      latitude: value.latitude,
      longitude: value.longitude,
    });
  }, [panelOpen, value.latitude, value.longitude]);

  useEffect(() => {
    if (!panelOpen || !mapAvailable || search.trim().length < 2) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchMapTilerPlaces(search.trim(), mapKey, controller.signal)
        .then((places) => {
          if (searchRequestRef.current !== requestId) return;
          setSuggestions(places);
        })
        .catch(() => {
          if (searchRequestRef.current !== requestId) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setSearching(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mapAvailable, mapKey, panelOpen, search]);

  const sendMapInit = () => {
    postToMap(iframeRef.current, {
      source: MAP_PICKER_SOURCE,
      type: "init",
      key: mapKey,
      latitude: valueRef.current.latitude,
      longitude: valueRef.current.longitude,
    });
  };

  const chooseSuggestion = (place: GeocodedPlace) => {
    onChange(place);
    setSearch(place.label);
    setSuggestions([]);
    setLocationMessage(null);
  };

  const useMyLocation = () => {
    if (!canGeolocate) return;
    setLocationMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void applyMapMove(position.coords.latitude, position.coords.longitude);
      },
      () => {
        setLocationMessage("Location isn’t available right now.");
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
    );
  };

  const heading = required ? "Place name" : "Place";
  const triggerName = `Place, ${placeTriggerLabel(value)}`;

  return (
    <div ref={rootRef} className="composer-location-fields">
      <div className="composer-field composer-picker-field">
        <span>
          {heading}
          {optional ? <small> Optional</small> : null}
        </span>
        <button
          type="button"
          className="composer-picker-trigger"
          aria-label={triggerName}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => {
            setSearch(value.label);
            setOpen((current) => !current);
          }}
        >
          <span
            className={value.label.trim() ? undefined : "composer-picker-empty"}
          >
            {placeTriggerLabel(value)}
          </span>
          <span aria-hidden="true">⌖</span>
        </button>
      </div>

      {panelOpen ? (
        <ComposerPickerPanel
          className="composer-picker-panel composer-location-panel"
          role="dialog"
          aria-label="Choose a place"
        >
          <label className="composer-field">
            <span>Search</span>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              maxLength={160}
              aria-required={required || undefined}
              aria-invalid={invalid ? true : undefined}
              aria-label="Place name"
              placeholder={
                mapAvailable ? "Search for a place" : "Add a place by hand"
              }
              onChange={(event) => {
                const nextLabel = event.target.value;
                setSearch(nextLabel);
                setSuggestions([]);
                setSearching(false);
                onChange({
                  ...value,
                  label: nextLabel,
                  ...(nextLabel.trim() ? {} : emptyPlaceSelection()),
                });
              }}
            />
          </label>

          {canGeolocate ? (
            <button
              type="button"
              className="composer-picker-secondary composer-location-geolocate"
              onClick={useMyLocation}
            >
              Use my location
            </button>
          ) : null}

          {locationMessage ? (
            <p className="composer-location-status" role="status">
              {locationMessage}
            </p>
          ) : null}

          {searching ? (
            <p className="composer-location-status">Looking up places…</p>
          ) : null}

          {suggestions.length > 0 ? (
            <ul className="composer-location-suggestions">
              {suggestions.map((place) => (
                <li key={`${place.label}-${place.latitude}-${place.longitude}`}>
                  <button type="button" onClick={() => chooseSuggestion(place)}>
                    {place.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {mapAvailable ? (
            <iframe
              ref={iframeRef}
              className="composer-location-map"
              title="Place map"
              src={MAP_PICKER_PATH}
              referrerPolicy="no-referrer"
              onLoad={sendMapInit}
            />
          ) : (
            <p className="composer-location-unavailable" role="status">
              Map unavailable
            </p>
          )}

          {value.label.trim() ? (
            <button
              type="button"
              className="composer-picker-secondary"
              onClick={() => {
                onChange(emptyPlaceSelection());
                setSearch("");
                setSuggestions([]);
                setOpen(false);
              }}
            >
              Clear place
            </button>
          ) : null}
        </ComposerPickerPanel>
      ) : null}
    </div>
  );
}
