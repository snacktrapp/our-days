"use client";

import { FullscreenMediaViewer } from "@/components/fullscreen-media-viewer";
import { PrivateVideoPlayer } from "@/components/private-video-player";
import { useVideoPoster } from "@/features/video/video-poster-store";
import type { VideoMomentViewModel } from "./timeline-view-model";

export function VideoMomentMedia({
  moment,
  label,
}: Readonly<{
  moment: VideoMomentViewModel;
  label: string;
}>) {
  const storedPoster = useVideoPoster(moment.id);
  const poster = moment.video.poster ?? storedPoster ?? undefined;
  return (
    <FullscreenMediaViewer
      kind="video"
      label={label}
      reactionTargetId={moment.id}
      preview={
        poster ? (
          // Poster is a local data URL captured during prep; it must not
          // enter the public image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="video-card-poster"
            src={poster}
            alt=""
            width={moment.video.width}
            height={moment.video.height}
          />
        ) : (
          <div className="video-card-mat" aria-hidden="true" />
        )
      }
      fullscreenMedia={
        <PrivateVideoPlayer
          src={moment.video.src}
          label={label}
          poster={poster}
          preload="metadata"
          autoPlay
          width={moment.video.width}
          height={moment.video.height}
        />
      }
    />
  );
}
