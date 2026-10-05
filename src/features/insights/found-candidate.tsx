"use client";

import { foundSpotUrl, type FoundCandidate } from "./found-types";

type FoundCandidateBodyProps = Readonly<{
  candidate: FoundCandidate;
  showVerified?: boolean;
  quoted?: boolean;
}>;

export function FoundCandidateBody({
  candidate,
  showVerified = false,
  quoted = false,
}: FoundCandidateBodyProps) {
  const hasSource = Boolean(
    candidate.sourceTitle ||
    candidate.sourceSite ||
    candidate.channelName ||
    candidate.atLabel ||
    candidate.videoId,
  );
  return (
    <div className="found-candidate">
      <blockquote className="found-card-quote">
        {quoted ? `“${candidate.quote}”` : candidate.quote}
      </blockquote>
      {candidate.speaker ? (
        <p
          className={
            candidate.speakerInSource === true
              ? "found-speaker"
              : "found-speaker is-quiet"
          }
        >
          — {candidate.speaker}
        </p>
      ) : null}
      {hasSource ? (
        <div className="found-source">
          {candidate.sourceTitle ? (
            <p className="found-source-title">{candidate.sourceTitle}</p>
          ) : null}
          {candidate.sourceSite ||
          candidate.channelName ||
          candidate.atLabel ? (
            <p className="found-source-meta">
              {candidate.sourceSite ? (
                <span>{candidate.sourceSite}</span>
              ) : null}
              {candidate.channelName ? (
                <span className="found-source-channel">
                  {candidate.channelName}
                </span>
              ) : null}
              {candidate.atLabel ? <span>{candidate.atLabel}</span> : null}
            </p>
          ) : null}
          {candidate.videoId ? (
            // Same-origin proxy. A broken thumbnail stays hidden.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="found-thumb"
              src={`/api/insights/found/thumbnail?v=${encodeURIComponent(candidate.videoId)}`}
              alt=""
              width={320}
              height={180}
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ) : null}
        </div>
      ) : null}
      {showVerified ? (
        <p className="found-verified">
          <span aria-hidden="true">✓ </span>
          {candidate.verifiedLabel}
        </p>
      ) : null}
      <a
        className="found-spot"
        href={foundSpotUrl(candidate.sourceUrl, candidate.quote)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open at this spot
      </a>
    </div>
  );
}
