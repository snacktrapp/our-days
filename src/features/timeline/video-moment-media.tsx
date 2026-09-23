"use client";

import { useEffect, useRef, useState } from "react";

import { PrivateVideoPlayer } from "@/components/private-video-player";
import {
  rememberVideoFrame,
  rememberVideoPoster,
  useVideoFrame,
  useVideoPoster,
} from "@/features/video/video-poster-store";
import {
  markVideoPosterPersisted,
  persistVideoPoster,
} from "@/features/video/persist-video-poster";
import { warmVideoPoster } from "@/features/video/warm-video-poster";
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
) {
  rememberVideoPoster(momentId, frame.posterDataUrl);
  rememberVideoFrame(momentId, frame.width, frame.height);
  void persistVideoPoster({
    momentId,
    posterDataUrl: frame.posterDataUrl,
    width: frame.width,
    height: frame.height,
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
  const candidatePoster = moment.video.poster ?? storedPoster ?? undefined;
  const { objectUrl: fetchedPoster, failed: posterFetchFailed } =
    usePrivateMediaObjectUrl(candidatePoster);
  const poster = posterFetchFailed ? undefined : (fetchedPoster ?? undefined);
  const [videoNearViewport, setVideoNearViewport] = useState(false);
  const width = moment.video.width ?? storedFrame?.width ?? 16;
  const height = moment.video.height ?? storedFrame?.height ?? 9;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (moment.video.poster?.startsWith("/api/media/videos/")) {
      markVideoPosterPersisted(moment.id);
    }
  }, [moment.id, moment.video.poster]);
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
        if (!poster) {
          void warmVideoPoster({
            momentId: moment.id,
            src: moment.video.src,
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
  }, [moment.id, moment.video.src, poster]);
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
        preload={videoNearViewport ? "metadata" : "none"}
        controls
        playsInline
        width={width}
        height={height}
        onReadyFrame={(frame) => handleCapturedFrame(moment.id, frame)}
      />
    </div>
  );
}
