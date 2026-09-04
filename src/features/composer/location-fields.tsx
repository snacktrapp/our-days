"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  publicMapTilerKey,
  reverseGeocodeForComposer,
  searchPlacesForComposer,
  type GeocodedPlace,
} from "./maptiler";
import { ComposerPickerPanel } from "./composer-picker-panel";
import { MapPickerFrame } from "./map-picker-frame";
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

export function LocationFields({
  value,
  required = false,
  optional = false,
  invalid = false,
  searchInputRef,
  onChange,
}: LocationFieldsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const localSearchRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? localSearchRef;
  const searchRequestRef = useRef(0);
  const valueRef = useRef(value);
  const [open, setOpen] = useState(required);
  const [search, setSearch] = useState(value.label);
  const [suggestions, setSuggestions] = useState<readonly GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const mapKey = publicMapTilerKey();
  const canGeolocate =
    typeof navigator !== "undefined" && "geolocation" in navigator;
  const panelOpen = required || open || invalid;

  const applyMapMove = useCallback(
    async (latitude: number, longitude: number) => {
      let label = valueRef.current.label.trim();
      try {
        const reversed = await reverseGeocodeForComposer(
          latitude,
          longitude,
          mapKey,
        );
        if (reversed) label = reversed;
      } catch {
        // Keep the label the family already typed.
      }
      const nextLabel =
        label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      onChange({
        label: nextLabel,
        latitude,
        longitude,
      });
      setSearch(nextLabel);
      setSuggestions([]);
      setLocationMessage(null);
    },
    [mapKey, onChange],
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!required) return;
    const frame = window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [inputRef, required]);

  useEffect(() => {
    if (!invalid) return;
    inputRef.current?.focus();
  }, [inputRef, invalid]);

  useEffect(() => {
    if (required || !panelOpen) return;
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
  }, [panelOpen, required]);

  useEffect(() => {
    if (!panelOpen || search.trim().length < 2) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchPlacesForComposer(search.trim(), mapKey, controller.signal)
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
  }, [mapKey, panelOpen, search]);

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
  const searchField = (
    <div className="composer-location-search">
      <label className="composer-field">
        <span>Search</span>
        <input
          ref={inputRef}
          type="text"
          value={search}
          maxLength={160}
          autoFocus={required}
          aria-required={required || undefined}
          aria-invalid={invalid ? true : undefined}
          aria-label="Place name"
          placeholder="Search for a place"
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
          className="composer-location-locate"
          aria-label="Use my location"
          onClick={useMyLocation}
        >
          <span aria-hidden="true">⌖</span>
        </button>
      ) : null}
    </div>
  );
  const placePanel = (
    <>
      {searchField}

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

      {value.latitude != null && value.longitude != null ? (
        <MapPickerFrame
          className="composer-location-map"
          title={`Map of ${value.label}`}
          mapKey={mapKey}
          latitude={value.latitude}
          longitude={value.longitude}
          onMoved={(latitude, longitude) => {
            void applyMapMove(latitude, longitude);
          }}
        />
      ) : (
        <p className="composer-location-unavailable" role="status">
          Search to see this place on a map
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
            if (!required) setOpen(false);
          }}
        >
          Clear place
        </button>
      ) : null}
    </>
  );

  return (
    <div ref={rootRef} className="composer-location-fields">
      {required ? null : (
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
              className={
                value.label.trim() ? undefined : "composer-picker-empty"
              }
            >
              {placeTriggerLabel(value)}
            </span>
            <span aria-hidden="true">⌖</span>
          </button>
        </div>
      )}

      {panelOpen ? (
        required ? (
          <div className="composer-location-panel">{placePanel}</div>
        ) : (
          <ComposerPickerPanel
            className="composer-picker-panel composer-location-panel"
            role="dialog"
            aria-label="Choose a place"
          >
            {placePanel}
          </ComposerPickerPanel>
        )
      ) : null}
    </div>
  );
}
