"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { FoundCandidateBody } from "./found-candidate";
import {
  foundEmptyMessage,
  foundTimeoutMessage,
  parseFoundQuery,
  type FoundCandidate,
  type FoundSourceKind,
} from "./found-types";
import { foundInsightRequestBody, type FoundInsightPost } from "./found-types";

function fitFoundQuery(field: HTMLTextAreaElement) {
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

export async function postFoundInsight(post: FoundInsightPost) {
  const response = await fetch("/api/insights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(foundInsightRequestBody(post)),
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    message?: string;
    momentId?: string;
  } | null;
  if (!response.ok || !payload?.ok || typeof payload.momentId !== "string") {
    return {
      ok: false as const,
      error: payload?.message ?? "Insight could not be created.",
    };
  }
  return { ok: true as const, momentId: payload.momentId };
}

function isCandidate(value: unknown): value is FoundCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as FoundCandidate;
  return (
    typeof candidate.quote === "string" &&
    typeof candidate.attribution === "string" &&
    typeof candidate.sourceUrl === "string" &&
    (candidate.sourceLabel === "Listen" ||
      candidate.sourceLabel === "Read the source") &&
    typeof candidate.verifiedLabel === "string"
  );
}

type FoundSearchPanelProps = Readonly<{
  sourceKind: FoundSourceKind;
  query: string;
  candidates: readonly FoundCandidate[];
  message: string | null;
  onQueryChange: (query: string) => void;
  onResult: (
    result: Readonly<{
      candidates: readonly FoundCandidate[];
      message: string | null;
    }>,
  ) => void;
  onUse: (candidate: FoundCandidate) => void;
}>;

export function FoundSearchPanel({
  sourceKind,
  query,
  candidates,
  message,
  onQueryChange,
  onResult,
  onUse,
}: FoundSearchPanelProps) {
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const field = queryRef.current;
    if (field) fitFoundQuery(field);
  }, [query]);

  const search = async () => {
    queryRef.current?.blur();
    const trimmed = parseFoundQuery(query);
    if (!trimmed || searching) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    try {
      const response = await fetch("/api/insights/found", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed, sourceKind }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        candidates?: unknown;
      } | null;
      const nextMessage =
        payload && typeof payload.message === "string" ? payload.message : null;
      const nextCandidates = Array.isArray(payload?.candidates)
        ? payload.candidates.filter(isCandidate)
        : [];
      if (!response.ok || payload?.ok !== true) {
        onResult({
          candidates: [],
          message: nextMessage ?? foundEmptyMessage,
        });
        return;
      }
      onResult({
        candidates: nextCandidates,
        message: nextCandidates.length
          ? null
          : (nextMessage ?? foundEmptyMessage),
      });
    } catch {
      if (controller.signal.aborted) return;
      onResult({ candidates: [], message: foundTimeoutMessage });
    } finally {
      if (abortRef.current === controller) setSearching(false);
    }
  };

  return (
    <div className="found-search">
      <form
        className="found-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label htmlFor="found-query">What are you looking for?</label>
        <div className="found-search-row">
          <textarea
            ref={queryRef}
            id="found-query"
            rows={1}
            value={query}
            maxLength={280}
            enterKeyHint="search"
            disabled={searching}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          {searching ? (
            <button
              type="button"
              className="found-find"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </button>
          ) : (
            <button
              className="found-find"
              type="submit"
              disabled={!query.trim()}
            >
              Find
            </button>
          )}
        </div>
      </form>
      <p className="found-status" role="status" aria-live="polite">
        {searching ? "Searching sources…" : (message ?? "")}
      </p>
      <div className="found-cards">
        {candidates.map((candidate) => {
          const key = `${candidate.sourceUrl}:${candidate.quote.slice(0, 24)}`;
          return (
            <article className="found-card" key={key}>
              <FoundCandidateBody candidate={candidate} showVerified />
              <button
                type="button"
                className="save-moment"
                onClick={() => onUse(candidate)}
              >
                Use this
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
