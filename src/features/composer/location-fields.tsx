"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  reverseGeocodeForComposer,
  searchPlacesForComposer,
  type GeocodedPlace,
} from "./maptiler";
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

export function LocationFields({
  value,
  required = false,
  optional = false,
  invalid = false,
  searchInputRef,
  onChange,
}: LocationFieldsProps) {
  const localSearchRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? localSearchRef;
  const searchRequestRef = useRef(0);
  const valueRef = useRef(value);
  const [search, setSearch] = useState(value.label);
  const [suggestions, setSuggestions] = useState<readonly GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const canGeolocate =
    typeof navigator !== "undefined" && "geolocation" in navigator;

  const applyMapMove = useCallback(
    async (latitude: number, longitude: number) => {
      let label = valueRef.current.label.trim();
      try {
        const reversed = await reverseGeocodeForComposer(latitude, longitude);
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
    [onChange],
  );

  useEffect(() => {
    valueRef.current = value;
    if (document.activeElement !== inputRef.current) {
      setSearch(value.label);
    }
  }, [inputRef, value]);

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
    if (search.trim().length < 2) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchPlacesForComposer(search.trim(), controller.signal)
        .then((places) => {
          if (searchRequestRef.current !== requestId) return;
          setSuggestions(places);
          setLocationMessage(
            places.length === 0 ? "No matching places." : null,
          );
        })
        .catch(() => {
          if (searchRequestRef.current !== requestId) return;
          setSuggestions([]);
          setLocationMessage("Place search isn’t available right now.");
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setSearching(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const chooseSuggestion = (place: GeocodedPlace) => {
    onChange({
      label: place.label,
      latitude: place.latitude,
      longitude: place.longitude,
    });
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

  return (
    <div className="composer-location-fields">
      <div className="composer-location-search">
        <label className="composer-field">
          <span>
            Search for a place
            {optional ? <small> Optional</small> : null}
          </span>
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
              setLocationMessage(null);
              onChange({
                ...value,
                label: nextLabel,
                ...(nextLabel.trim() ? {} : emptyPlaceSelection()),
              });
            }}
          />
        </label>
      </div>
      {canGeolocate ? (
        <button
          type="button"
          className="composer-location-locate"
          onClick={useMyLocation}
        >
          <span aria-hidden="true">⌖</span>
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
                <span>{place.label}</span>
                {place.detail && place.detail !== place.label ? (
                  <small>{place.detail}</small>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {value.label.trim() ? (
        <button
          type="button"
          className="composer-picker-secondary"
          onClick={() => {
            onChange(emptyPlaceSelection());
            setSearch("");
            setSuggestions([]);
          }}
        >
          Clear place
        </button>
      ) : null}
    </div>
  );
}
