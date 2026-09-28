"use client";

import { useState } from "react";
import {
  youtubeEmbedSrc,
  youtubePlaybackFromSource,
  youtubeThumbnailUrl,
  type YoutubeThumbVariant,
} from "./youtube-source";

const thumbOrder: readonly YoutubeThumbVariant[] = [
  "hqdefault",
  "mqdefault",
  "default",
];

export function FoundYoutubeFrame({
  sourceUrl,
}: Readonly<{ sourceUrl: string }>) {
  const playback = youtubePlaybackFromSource(sourceUrl);
  const [playing, setPlaying] = useState(false);
  const [thumbIndex, setThumbIndex] = useState(0);
  if (!playback) return null;
  const embedSrc = youtubeEmbedSrc(playback);
  if (!embedSrc) return null;
  const variant = thumbOrder[thumbIndex];
  const thumb = variant ? youtubeThumbnailUrl(playback.id, variant) : null;

  if (playing) {
    return (
      <div className="found-youtube">
        <iframe
          src={embedSrc}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="found-youtube"
      aria-label="Play video"
      onClick={() => setPlaying(true)}
    >
      {thumb ? (
        // The id is the validated 11-character watch id, so the URL is fixed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          onError={() => setThumbIndex((index) => index + 1)}
        />
      ) : null}
      <span className="found-youtube-play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
          <path d="M9 7.5v9l8-4.5-8-4.5z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}
