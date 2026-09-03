"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import {
  showModalPreservingScroll,
  useLockBackgroundScroll,
} from "@/features/dialog/lock-background-scroll";

type InspectionState = "empty" | "inspecting" | "ready" | "error";

const allowedVideoTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);
const fallbackVideoExtension = /\.(m4v|mov|mp4|webm)$/iu;
const byteLimit = 100 * 1024 * 1024;
const durationLimitSeconds = 60.5;
const pixelLimit = 9_000_000;
const slowInspectionDelayMs = 5_000;
const inspectionTimeoutMs = 15_000;

function acceptsLocalVideo(file: File) {
  const declaredType = file.type.trim().toLowerCase();
  if (declaredType) return allowedVideoTypes.has(declaredType);
  return fallbackVideoExtension.test(file.name);
}

type VideoFeasibilityDialogProps = Readonly<{
  open: boolean;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
}>;

function VideoFeasibilityDialog({
  open,
  returnFocusRef,
  onRequestClose,
}: VideoFeasibilityDialogProps) {
  const [inspectionState, setInspectionState] =
    useState<InspectionState>("empty");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slowInspection, setSlowInspection] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeUrlRef = useRef<string | null>(null);
  const metadataReadyUrlRef = useRef<string | null>(null);
  const frameReadyUrlRef = useRef<string | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInspectionTimers = useCallback(() => {
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    slowTimerRef.current = null;
    timeoutTimerRef.current = null;
  }, []);

  const unloadVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, []);

  const revokeActiveUrl = useCallback(() => {
    clearInspectionTimers();
    const url = activeUrlRef.current;
    activeUrlRef.current = null;
    metadataReadyUrlRef.current = null;
    frameReadyUrlRef.current = null;
    unloadVideo();
    if (!url) return;
    URL.revokeObjectURL(url);
  }, [clearInspectionTimers, unloadVideo]);

  const resetSelection = useCallback(() => {
    revokeActiveUrl();
    metadataReadyUrlRef.current = null;
    frameReadyUrlRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setPreviewUrl(null);
    setInspectionState("empty");
    setError(null);
    setSlowInspection(false);
    setDurationSeconds(null);
  }, [revokeActiveUrl]);

  const rejectSelection = useCallback(
    (message: string, expectedUrl?: string) => {
      if (expectedUrl && activeUrlRef.current !== expectedUrl) return;
      revokeActiveUrl();
      metadataReadyUrlRef.current = null;
      frameReadyUrlRef.current = null;
      if (inputRef.current) inputRef.current.value = "";
      setPreviewUrl(null);
      setInspectionState("error");
      setError(message);
      setSlowInspection(false);
      setDurationSeconds(null);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [revokeActiveUrl],
  );

  const acceptReadyVideo = useCallback(
    (expectedUrl: string, duration: number) => {
      if (
        activeUrlRef.current !== expectedUrl ||
        metadataReadyUrlRef.current !== expectedUrl ||
        frameReadyUrlRef.current !== expectedUrl
      )
        return;
      clearInspectionTimers();
      setInspectionState("ready");
      setError(null);
      setSlowInspection(false);
      setDurationSeconds(duration);
    },
    [clearInspectionTimers],
  );

  const inspectFile = (file: File | null) => {
    resetSelection();
    if (!file) return;
    if (!acceptsLocalVideo(file)) {
      rejectSelection("Choose an MP4, MOV, M4V, or WebM video.");
      return;
    }
    if (file.size === 0) {
      rejectSelection("That video is empty. Choose another one.");
      return;
    }
    if (file.size > byteLimit) {
      rejectSelection(
        "Choose a video smaller than 100 MB for this feasibility preview.",
      );
      return;
    }

    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      rejectSelection(
        "This video could not be opened on this device. Choose another one.",
      );
      return;
    }
    activeUrlRef.current = url;
    setPreviewUrl(url);
    setInspectionState("inspecting");
    setError(null);
    slowTimerRef.current = setTimeout(() => {
      if (activeUrlRef.current === url) setSlowInspection(true);
    }, slowInspectionDelayMs);
    timeoutTimerRef.current = setTimeout(() => {
      rejectSelection(
        "This video took too long to inspect. Choose another one.",
        url,
      );
    }, inspectionTimeoutMs);
  };

  const removeSelection = () => {
    resetSelection();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const inspectMetadata = (expectedUrl: string, video: HTMLVideoElement) => {
    if (activeUrlRef.current !== expectedUrl) return;
    const { duration, videoHeight, videoWidth } = video;
    if (!Number.isFinite(duration) || duration <= 0) {
      rejectSelection(
        "This video's duration could not be read. Choose another one.",
        expectedUrl,
      );
      return;
    }
    if (duration > durationLimitSeconds) {
      rejectSelection(
        "Choose a video about 60 seconds or shorter for this feasibility preview.",
        expectedUrl,
      );
      return;
    }
    if (
      videoWidth <= 0 ||
      videoHeight <= 0 ||
      videoWidth * videoHeight > pixelLimit
    ) {
      rejectSelection(
        "This video's picture size is not supported by the feasibility preview.",
        expectedUrl,
      );
      return;
    }
    metadataReadyUrlRef.current = expectedUrl;
    setDurationSeconds(duration);
    acceptReadyVideo(expectedUrl, duration);
  };

  const close = useCallback(() => {
    if (
      activeUrlRef.current &&
      !window.confirm("Discard this local video preview?")
    )
      return;
    resetSelection();
    onRequestClose();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onRequestClose, resetSelection, returnFocusRef]);

  useEffect(() => () => revokeActiveUrl(), [revokeActiveUrl]);

  useLockBackgroundScroll(open);

  // Lock is declared first so React cleanup closes the dialog, then restores scroll.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    showModalPreservingScroll(dialog);
    const focusFrame = window.requestAnimationFrame(() =>
      inputRef.current?.focus(),
    );

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  const status =
    inspectionState === "ready"
      ? `Clip ready to preview · ${Math.ceil(durationSeconds ?? 0)} seconds`
      : inspectionState === "inspecting"
        ? slowInspection
          ? "Still checking this clip on your device…"
          : "Checking this clip on your device…"
        : "";

  return (
    <dialog
      ref={dialogRef}
      className="composer-dialog video-feasibility-dialog"
      aria-labelledby="video-feasibility-title"
      aria-describedby="video-feasibility-privacy"
      onKeyDown={containDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="composer-sheet">
        <span className="sheet-handle" aria-hidden="true" />
        <button
          className="sheet-close"
          aria-label="Close video feasibility preview"
          onClick={close}
        >
          ×
        </button>
        <span id="video-feasibility-privacy" className="private-label">
          Local feasibility preview · Nothing is uploaded or saved
        </span>
        <h2 id="video-feasibility-title">Try one short video</h2>
        <p className="video-feasibility-explainer">
          This isolated test checks whether an ordinary family clip feels calm
          and reliable on this device. It does not add video to Our Days.
        </p>

        <label className="video-feasibility-input">
          <span id="video-feasibility-picker-label">
            {previewUrl ? "Choose a different video" : "Choose a short video"}
          </span>
          <small id="video-feasibility-picker-constraints">
            One local clip · about 60 seconds · up to 100 MB
          </small>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            aria-labelledby="video-feasibility-picker-label"
            aria-invalid={error ? true : undefined}
            aria-describedby={
              error
                ? "video-feasibility-picker-constraints video-feasibility-error"
                : "video-feasibility-picker-constraints"
            }
            onChange={(event) =>
              inspectFile(event.currentTarget.files?.[0] ?? null)
            }
          />
        </label>

        {error ? (
          <p
            id="video-feasibility-error"
            className="composer-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <p
          className="video-feasibility-status"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>

        {previewUrl ? (
          <div className="video-feasibility-player">
            <video
              ref={videoRef}
              key={previewUrl}
              src={previewUrl}
              aria-label="Selected video preview"
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) =>
                inspectMetadata(previewUrl, event.currentTarget)
              }
              onLoadedData={(event) => {
                if (activeUrlRef.current !== previewUrl) return;
                frameReadyUrlRef.current = previewUrl;
                acceptReadyVideo(previewUrl, event.currentTarget.duration);
              }}
              onError={() =>
                rejectSelection(
                  "This video could not be played. Choose another one.",
                  previewUrl,
                )
              }
            />
            <button type="button" onClick={removeSelection}>
              Remove video
            </button>
          </div>
        ) : null}

        <p className="composer-preview-note">
          Closing or reloading forgets the selection. No filename, clip, or
          device detail is recorded by this preview.
        </p>
        <button className="save-moment" type="button" onClick={close}>
          Close local preview
        </button>
      </section>
    </dialog>
  );
}

export function VideoFeasibilityPanel() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <section
        className="timeline video-feasibility-timeline"
        aria-label="Short video feasibility timeline"
      >
        <div className="time-rail" aria-hidden="true" />
        <div className="date-marker">
          <span>Local experiment</span>
        </div>
        <article className="moment moment-video">
          <div className="connection">
            <span className="avatar-node dot-teal" aria-hidden="true">
              Y
            </span>
            <span className="moment-meta">
              <strong>You</strong>
              <span>On this device</span>
            </span>
          </div>
          <div className="moment-card video-feasibility-card">
            <button
              ref={triggerRef}
              className="video-feasibility-mat"
              type="button"
              onClick={() => setOpen(true)}
            >
              <span aria-hidden="true">▶</span>
              <small>Try a short video</small>
            </button>
            <div className="card-copy">
              <p className="moment-kicker">A possibility, not a promise</p>
              <h2>A little motion, without turning memories into a feed.</h2>
              <p>
                Try one clip locally to judge the rhythm, controls, and phone
                behavior before video becomes a product feature.
              </p>
            </div>
          </div>
          <time dateTime="2026-08-30">Quality-only preview</time>
        </article>
        <div className="date-marker year-marker">
          <span>Decision still pending</span>
        </div>
        <p className="timeline-whisper">
          Passing this test would show only that local capture and playback are
          viable—not that private upload, delivery, export, or deletion are
          solved.
        </p>
      </section>
      <VideoFeasibilityDialog
        open={open}
        returnFocusRef={triggerRef}
        onRequestClose={() => setOpen(false)}
      />
    </>
  );
}
