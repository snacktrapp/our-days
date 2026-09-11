"use client";

import { FullscreenMediaViewer } from "@/components/fullscreen-media-viewer";
import { PrivateVideoPlayer } from "@/components/private-video-player";
import {
  rememberVideoFrame,
  rememberVideoPoster,
  useVideoFrame,
  useVideoPoster,
} from "@/features/video/video-poster-store";
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

export function VideoMomentMedia({
  moment,
  label,
}: Readonly<{
  moment: VideoMomentViewModel;
  label: string;
}>) {
  const storedPoster = useVideoPoster(moment.id);
  const storedFrame = useVideoFrame(moment.id);
  const poster = moment.video.poster ?? storedPoster ?? undefined;
  const width = moment.video.width ?? storedFrame?.width;
  const height = moment.video.height ?? storedFrame?.height;
  const knownRatio = Boolean(width && height && width > 0 && height > 0);

  return (
    <div
      className={`photo-frame video-frame${
        knownRatio ? " has-reserved-frame has-known-ratio" : ""
      }`}
    >
      {knownRatio ? <VideoFrameSizer width={width!} height={height!} /> : null}
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
              width={width}
              height={height}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  rememberVideoFrame(moment.id, naturalWidth, naturalHeight);
                }
              }}
            />
          ) : (
            <div
              className="video-card-mat"
              aria-hidden="true"
              style={
                knownRatio ? { aspectRatio: `${width} / ${height}` } : undefined
              }
            />
          )
        }
        fullscreenMedia={
          <PrivateVideoPlayer
            src={moment.video.src}
            label={label}
            poster={poster}
            preload="metadata"
            autoPlay
            width={width}
            height={height}
            onReadyFrame={({
              posterDataUrl,
              width: frameWidth,
              height: frameHeight,
            }) => {
              rememberVideoPoster(moment.id, posterDataUrl);
              rememberVideoFrame(moment.id, frameWidth, frameHeight);
            }}
          />
        }
      />
    </div>
  );
}
