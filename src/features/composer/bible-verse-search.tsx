"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  parseBibleVerseReference,
  type BibleVerseSelection,
} from "./bible-verse-catalog";
import {
  foundEmptyMessage,
  foundTimeoutMessage,
  parseFoundQuery,
  type FoundCandidate,
} from "@/features/insights/found-types";

function fitQuery(field: HTMLTextAreaElement) {
  const style = getComputedStyle(field);
  const line = Number.parseFloat(style.lineHeight) || 21;
  const padding =
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom);
  const border =
    Number.parseFloat(style.borderTopWidth) +
    Number.parseFloat(style.borderBottomWidth);
  const min = Math.max(40, line + padding + border);
  const max = line * 5 + padding + border;
  field.style.height = "0px";
  const next = Math.min(Math.max(field.scrollHeight + border, min), max);
  field.style.height = `${next}px`;
}

function isCandidate(value: unknown): value is FoundCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as FoundCandidate;
  return (
    typeof candidate.quote === "string" &&
    typeof candidate.attribution === "string"
  );
}

function selectionFromCandidate(candidate: FoundCandidate) {
  const reference = candidate.attribution
    .replace(/ · World English Bible$/u, "")
    .trim();
  return parseBibleVerseReference(reference);
}

export function BibleVerseSearch({
  onPick,
}: Readonly<{
  onPick: (selection: BibleVerseSelection) => void;
}>) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<readonly FoundCandidate[]>([]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field) fitQuery(field);
  }, [query]);

  const search = async () => {
    const trimmed = parseFoundQuery(query);
    if (!trimmed || searching) return;
    setSearching(true);
    setMessage(null);
    try {
      const response = await fetch("/api/insights/found", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed, sourceKind: "bible" }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        candidates?: unknown;
      } | null;
      const next = Array.isArray(payload?.candidates)
        ? payload.candidates.filter(isCandidate)
        : [];
      if (!response.ok || payload?.ok !== true || next.length === 0) {
        setCandidates([]);
        setMessage(
          typeof payload?.message === "string"
            ? payload.message
            : foundEmptyMessage,
        );
        return;
      }
      setCandidates(next);
    } catch {
      setCandidates([]);
      setMessage(foundTimeoutMessage);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="bible-verse-search">
      <div className="found-search-form">
        <label htmlFor="bible-verse-query">
          {"Describe the verse you're looking for"}
        </label>
        <div className="found-search-row">
          <textarea
            ref={fieldRef}
            id="bible-verse-query"
            rows={1}
            value={query}
            maxLength={280}
            enterKeyHint="search"
            disabled={searching}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }
              event.preventDefault();
              void search();
            }}
          />
          <button
            className="found-find"
            type="button"
            disabled={searching || !query.trim()}
            onClick={() => void search()}
          >
            {searching ? "Searching…" : "Find"}
          </button>
        </div>
      </div>
      {message ? (
        <p className="found-status" role="status">
          {message}
        </p>
      ) : null}
      {candidates.length > 0 ? (
        <div className="bible-verse-search-results">
          {candidates.map((candidate) => {
            const selection = selectionFromCandidate(candidate);
            return (
              <button
                key={`${candidate.attribution}:${candidate.quote.slice(0, 24)}`}
                type="button"
                className="bible-verse-search-result"
                disabled={!selection}
                onClick={() => {
                  if (!selection) return;
                  onPick(selection);
                  setCandidates([]);
                  setMessage(null);
                }}
              >
                <span className="found-card-quote">{candidate.quote}</span>
                <span className="found-source-meta">
                  {candidate.attribution}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
