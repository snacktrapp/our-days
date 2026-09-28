"use client";

import { useRef, useState } from "react";
import {
  foundEmptyMessage,
  foundTimeoutMessage,
  parseFoundQuery,
  type FoundCandidate,
} from "./found-types";
import { foundInsightRequestBody, type FoundInsightPost } from "./found-types";

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
  onBack: () => void;
}>;

export function FoundSearchPanel({
  query,
  candidates,
  message,
  onQueryChange,
  onResult,
  onUse,
  onBack,
}: FoundSearchPanelProps) {
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = async () => {
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
        body: JSON.stringify({ query: trimmed }),
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
        <input
          id="found-query"
          value={query}
          maxLength={280}
          disabled={searching}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="found-search-actions">
          <button
            type="button"
            className="secondary-composer-action"
            onClick={onBack}
          >
            Back
          </button>
          {searching ? (
            <button
              type="button"
              className="secondary-composer-action"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </button>
          ) : (
            <button
              className="save-moment"
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
          const open = expanded === key;
          const long = candidate.quote.length > 180;
          return (
            <article className="found-card" key={key}>
              {candidate.videoId ? (
                // Same-origin proxy. A broken thumbnail stays hidden.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="found-thumb"
                  src={`/api/insights/found/thumbnail?v=${candidate.videoId}`}
                  alt=""
                  width={320}
                  height={180}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              ) : null}
              <p
                className={
                  open || !long
                    ? "found-card-quote"
                    : "found-card-quote is-clamped"
                }
              >
                {candidate.quote}
              </p>
              {long ? (
                <button
                  type="button"
                  className="found-more"
                  onClick={() => setExpanded(open ? null : key)}
                >
                  {open ? "Less" : "More"}
                </button>
              ) : null}
              <p className="found-card-meta">
                <span className="found-verified">
                  <span aria-hidden="true">✓ </span>
                  {candidate.verifiedLabel}
                </span>
                <span>{candidate.attribution}</span>
                {candidate.rangeLabel ? (
                  <span>{candidate.rangeLabel}</span>
                ) : null}
                <a
                  href={candidate.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {candidate.sourceLabel}
                </a>
              </p>
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
