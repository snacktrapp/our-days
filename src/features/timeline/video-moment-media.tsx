"use client";

import { useEffect, useRef, useState } from "react";

import { PrivateVideoPlayer } from "@/components/private-video-player";
import {
  rememberVideoFrame,
  rememberVideoPoster,
  useVideoFrame,
  useVideoPoster,
} from "@/features/video/video-poster-store";
import { persistVideoPoster } from "@/features/video/persist-video-poster";
import { warmVideoPoster } from "@/features/video/warm-video-poster";
import {
  posterDataUrlLooksLikelyBlank,
  posterLooksLikelyBlankByBytes,
} from "@/features/video/video-poster-quality";
import { usePrivateMediaObjectUrl } from "@/lib/use-private-media-object-url";
import type { VideoMomentViewModel } from "./timeline-view-model";

function VideoFrameSizer({
  width,
  height,
}: Readonly<{ width: number; height: number }>) {
  return (
    <svg
      className="photo-frame-sizer"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    />
  );
}

function handleCapturedFrame(
  momentId: string,
  frame: Readonly<{
    posterDataUrl: string;
    width: number;
    height: number;
  }>,
  options: Readonly<{
    hasServerPoster: boolean;
    shouldPersist: boolean;
    replaceExisting: boolean;
  }>,
) {
  const looksLikelyBlank = posterDataUrlLooksLikelyBlank(
    frame.posterDataUrl,
    frame.width,
    frame.height,
  );
  if (options.hasServerPoster && looksLikelyBlank) {
    return;
  }
  rememberVideoPoster(momentId, frame.posterDataUrl);
  rememberVideoFrame(momentId, frame.width, frame.height);
  if (!options.shouldPersist || looksLikelyBlank) return;
  void persistVideoPoster({
    momentId,
    posterDataUrl: frame.posterDataUrl,
    width: frame.width,
    height: frame.height,
    replaceExisting: options.replaceExisting,
  });
}

export function VideoMomentMedia({
  moment,
  label,
}: Readonly<{
  moment: Pick<VideoMomentViewModel, "id" | "video">;
  label: string;
}>) {
  const storedPoster = useVideoPoster(moment.id);
  const storedFrame = useVideoFrame(moment.id);
  const serverPosterLooksLikelyBlank = posterLooksLikelyBlankByBytes(
    moment.video.posterSizeBytes,
    moment.video.width,
    moment.video.height,
  );
  const hasGoodServerPoster =
    Boolean(moment.video.poster) && !serverPosterLooksLikelyBlank;
  const [videoNearViewport, setVideoNearViewport] = useState(false);
  const candidatePoster = storedPoster ?? moment.video.poster ?? undefined;
  const shouldLoadPoster =
    videoNearViewport ||
    typeof IntersectionObserver === "undefined" ||
    candidatePoster?.startsWith("data:") ||
    candidatePoster?.startsWith("blob:");
  const { objectUrl: fetchedPoster } = usePrivateMediaObjectUrl(
    shouldLoadPoster ? candidatePoster : undefined,
  );
  const poster = shouldLoadPoster
    ? (fetchedPoster ?? candidatePoster)
    : undefined;
  const shouldWarmPoster = !moment.video.poster || serverPosterLooksLikelyBlank;
  const shouldPersistPoster = !hasGoodServerPoster;
  const width = moment.video.width ?? storedFrame?.width ?? 16;
  const height = moment.video.height ?? storedFrame?.height ?? 9;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setVideoNearViewport(true);
        if (shouldWarmPoster) {
          void warmVideoPoster({
            momentId: moment.id,
            src: moment.video.src,
            replaceExistingPoster:
              shouldPersistPoster && Boolean(moment.video.poster),
          });
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    observer.observe(root);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [
    moment.id,
    moment.video.poster,
    moment.video.src,
    shouldPersistPoster,
    shouldWarmPoster,
  ]);
  const knownRatio = Boolean(
    (moment.video.width ?? storedFrame?.width) &&
    (moment.video.height ?? storedFrame?.height),
  );

  return (
    <div
      ref={rootRef}
      className={`photo-frame video-frame has-reserved-frame${
        knownRatio ? " has-known-ratio" : " has-default-video-ratio"
      }`}
    >
      <VideoFrameSizer width={width} height={height} />
      <PrivateVideoPlayer
        src={moment.video.src}
        label={label}
        poster={poster}
        preload={
          videoNearViewport ? (shouldWarmPoster ? "auto" : "metadata") : "none"
        }
        controls
        playsInline
        width={width}
        height={height}
        onReadyFrame={
          hasGoodServerPoster
            ? undefined
            : (frame) =>
                handleCapturedFrame(moment.id, frame, {
                  hasServerPoster: Boolean(moment.video.poster),
                  shouldPersist: shouldPersistPoster,
                  replaceExisting: Boolean(moment.video.poster),
                })
        }
      />
    </div>
  );
}
