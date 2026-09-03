"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import type { MomentKind } from "@/features/timeline/timeline-view-model";
import type { MomentComposerViewModel } from "./composer-view-model";
import type {
  SaveFamilyMomentAction,
  SaveWrittenMomentAction,
} from "@/features/moments/moment-action-types";
import { type PhotoUploadAttempt, type PhotoUploadStage } from "./photo-upload";
import {
  acceptedVideoMime,
  maximumVideoBytes,
  maximumVideoDurationMs,
  type VideoUploadAttempt,
  type VideoUploadStage,
} from "./video-upload";
import {
  emptyBibleVerseSelection,
  formatBibleVerseMoment,
  type BibleVerseSelection,
} from "./bible-verse-catalog";
import { BibleVerseFields } from "./bible-verse-fields";
import {
  startOptimisticPhotoUpload,
  startOptimisticVideoUpload,
} from "./optimistic-media-upload";
import { startOptimisticMomentSave } from "./optimistic-moment-save";
import { DateTimeFields } from "./date-time-fields";
import { JournalPickerField } from "./journal-picker-field";

type MomentComposerProps = Readonly<{
  model: MomentComposerViewModel;
  open: boolean;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
  saveFamilyMoment?: SaveFamilyMomentAction;
  saveWrittenMoment?: SaveWrittenMomentAction;
}>;

export type { SaveFamilyMomentAction, SaveWrittenMomentAction };

type ModeCopy = Readonly<{
  kindLabel: string;
  title: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  bodyRequired: boolean;
}>;

type ComposerMode = MomentKind | "bible-verse";

type PhotoDecodeState = "empty" | "decoding" | "ready" | "error";

const modeCopy: Readonly<Record<ComposerMode, ModeCopy>> = {
  photo: {
    kindLabel: "Photo",
    title: "New photo entry",
    bodyLabel: "Note",
    bodyPlaceholder: "Add context…",
    bodyRequired: false,
  },
  video: {
    kindLabel: "Video",
    title: "New video entry",
    bodyLabel: "Note",
    bodyPlaceholder: "Add context…",
    bodyRequired: false,
  },
  thought: {
    kindLabel: "Note",
    title: "New written entry",
    bodyLabel: "Entry",
    bodyPlaceholder: "Record what happened…",
    bodyRequired: true,
  },
  milestone: {
    kindLabel: "Milestone",
    title: "New milestone",
    bodyLabel: "Details",
    bodyPlaceholder: "Add relevant details…",
    bodyRequired: false,
  },
  "bible-verse": {
    kindLabel: "Bible verse",
    title: "Add a Bible verse",
    bodyLabel: "Verse text",
    bodyPlaceholder: "Choose a passage to fill this entry…",
    bodyRequired: true,
  },
  location: {
    kindLabel: "Location",
    title: "New location entry",
    bodyLabel: "Details",
    bodyPlaceholder: "Add context for this location…",
    bodyRequired: false,
  },
};

const previewImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const connectedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function plainDateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ] as const;
  const monthName = monthNames[Number(month) - 1];
  if (!monthName) return value;
  return `${monthName} ${Number(day)}, ${year}`;
}

function resolvePreviewTitle(
  title: string,
  body: string,
  hasPhoto: boolean,
  fallback: string,
) {
  if (title.trim()) return title.trim();
  if (body.trim()) return body.trim();
  if (hasPhoto) return "Photo entry";
  return fallback;
}

export function MomentComposer({
  model,
  open,
  returnFocusRef,
  onRequestClose,
  saveFamilyMoment,
  saveWrittenMoment,
}: MomentComposerProps) {
  const router = useRouter();
  // Connected saves now detach from this surface before network work begins.
  const saving = false;
  const [mode, setMode] = useState<ComposerMode | null>(null);
  const [choosingMode, setChoosingMode] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [verseSelection, setVerseSelection] = useState<BibleVerseSelection>(
    emptyBibleVerseSelection,
  );
  const [occurredOn, setOccurredOn] = useState(model.previewToday);
  const [occurredTime, setOccurredTime] = useState("");
  const [journalPersonId, setJournalPersonId] = useState(
    model.defaultJournalPersonId,
  );
  const [taggedPersonIds, setTaggedPersonIds] = useState<readonly string[]>([]);
  const [placeName, setPlaceName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoDecodeState, setPhotoDecodeState] =
    useState<PhotoDecodeState>("empty");
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoRetryable, setPhotoRetryable] = useState(true);
  const [photoUploadStage, setPhotoUploadStage] = useState<
    PhotoUploadStage | VideoUploadStage | null
  >(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const chooserHeadingRef = useRef<HTMLHeadingElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const verseBookTriggerRef = useRef<HTMLButtonElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);
  const photoUploadAttemptRef = useRef<PhotoUploadAttempt | null>(null);
  const videoUploadAttemptRef = useRef<VideoUploadAttempt | null>(null);
  const photoUploadAbortRef = useRef<AbortController | null>(null);
  const uploadInFlightRef = useRef(false);

  const journalPerson =
    model.journalPeople.find((person) => person.id === journalPersonId) ??
    model.journalPeople[0];
  const taggedPeople = model.taggablePeople.filter((person) =>
    taggedPersonIds.includes(person.id),
  );
  const copy = mode ? modeCopy[mode] : null;
  const connectedFamily = model.experience === "connected-family";
  const connectedExperience =
    connectedFamily || model.experience === "connected-written";
  const connectedPhotoAvailable = Boolean(
    connectedFamily && model.photoPostingEnabled && model.circleId,
  );
  const resolvedPlaceName = mode === "location" ? title : placeName;
  const isDirty = Boolean(
    body.length ||
    title.length ||
    verseSelection.book ||
    placeName.length ||
    photoFile ||
    taggedPersonIds.length ||
    occurredOn !== model.previewToday ||
    occurredTime.length > 0 ||
    journalPersonId !== model.defaultJournalPersonId,
  );

  const revokeCurrentPhotoUrl = useCallback(() => {
    if (photoPreviewUrlRef.current) {
      const url = photoPreviewUrlRef.current;
      photoPreviewUrlRef.current = null;
      URL.revokeObjectURL(url);
    }
  }, []);

  const clearPhotoPreview = useCallback(() => {
    revokeCurrentPhotoUrl();
    setPhotoPreviewUrl(null);
  }, [revokeCurrentPhotoUrl]);

  const rejectUndecodablePhoto = useCallback(
    (expectedUrl: string) => {
      if (photoPreviewUrlRef.current !== expectedUrl) return;
      clearPhotoPreview();
      setPhotoFile(null);
      setPhotoDecodeState("error");
      if (photoInputRef.current) photoInputRef.current.value = "";
      setPhotoError("This image could not be shown. Choose another one.");
    },
    [clearPhotoPreview],
  );

  const resetDraft = useCallback(
    (nextMode: ComposerMode | null = null) => {
      clearPhotoPreview();
      if (photoInputRef.current) photoInputRef.current.value = "";
      setMode(nextMode);
      setChoosingMode(false);
      setReviewing(false);
      setOptionalDetailsOpen(false);
      setBody("");
      setTitle("");
      setVerseSelection(emptyBibleVerseSelection);
      setOccurredOn(model.previewToday);
      setOccurredTime("");
      setJournalPersonId(model.defaultJournalPersonId);
      setTaggedPersonIds([]);
      setPlaceName("");
      setPhotoFile(null);
      setPhotoDecodeState("empty");
      setVideoDurationMs(null);
      setPhotoError(null);
      setContentError(null);
      setSaveError(null);
      setPhotoRetryable(true);
      photoUploadAbortRef.current?.abort();
      photoUploadAbortRef.current = null;
      photoUploadAttemptRef.current = null;
      videoUploadAttemptRef.current = null;
      uploadInFlightRef.current = false;
      setPhotoUploadStage(null);
    },
    [clearPhotoPreview, model.defaultJournalPersonId, model.previewToday],
  );

  const close = useCallback(
    (discardDraft = false) => {
      if (saving) return;
      if (
        !discardDraft &&
        isDirty &&
        !window.confirm("Discard this unfinished moment?")
      ) {
        return;
      }

      resetDraft();
      onRequestClose();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    },
    [isDirty, onRequestClose, resetDraft, returnFocusRef, saving],
  );

  useEffect(
    () => () => {
      photoUploadAbortRef.current?.abort();
      revokeCurrentPhotoUrl();
    },
    [revokeCurrentPhotoUrl],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const bodyWasLocked = document.body.classList.contains(
      "composer-scroll-locked",
    );
    document.body.classList.add("composer-scroll-locked");
    if (!dialog.open) dialog.showModal();

    return () => {
      if (!bodyWasLocked)
        document.body.classList.remove("composer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      if (reviewing) reviewHeadingRef.current?.focus();
      else if (mode && !choosingMode) {
        if (mode === "photo" || mode === "video")
          editorHeadingRef.current?.focus({ preventScroll: true });
        else if (mode === "thought") bodyTextareaRef.current?.focus();
        else if (mode === "bible-verse") verseBookTriggerRef.current?.focus();
        else titleInputRef.current?.focus();
      } else chooserHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [choosingMode, mode, open, reviewing]);

  const replacePhoto = (file: File | null) => {
    if (uploadInFlightRef.current) return;
    photoUploadAttemptRef.current = null;
    setPhotoUploadStage(null);
    clearPhotoPreview();
    setPhotoFile(null);
    setPhotoDecodeState("empty");
    setVideoDurationMs(null);
    setPhotoError(null);
    setPhotoRetryable(true);
    if (!file) {
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    const normalizedType = file.type.toLowerCase();
    const videoMime = acceptedVideoMime(file);
    if (videoMime) {
      if (file.size === 0) {
        setPhotoDecodeState("error");
        setPhotoError("That video is empty. Choose another one.");
        if (photoInputRef.current) photoInputRef.current.value = "";
        return;
      }
      if (file.size > maximumVideoBytes) {
        setPhotoDecodeState("error");
        setPhotoError("Choose a video smaller than 100 MB.");
        if (photoInputRef.current) photoInputRef.current.value = "";
        return;
      }
      const nextUrl = URL.createObjectURL(file);
      photoPreviewUrlRef.current = nextUrl;
      setMode("video");
      setPhotoFile(file);
      setPhotoPreviewUrl(nextUrl);
      setPhotoDecodeState("decoding");
      return;
    }
    const supportedType = connectedPhotoAvailable
      ? normalizedType === "" || connectedPhotoTypes.has(normalizedType)
      : previewImageTypes.has(normalizedType);
    if (!supportedType) {
      setPhotoDecodeState("error");
      setPhotoError(
        connectedPhotoAvailable
          ? "For now, choose a JPEG, PNG, or WebP photo."
          : "Choose an image file for this preview.",
      );
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    if (file.size === 0) {
      setPhotoDecodeState("error");
      setPhotoError("That image is empty. Choose another one.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPhotoDecodeState("error");
      setPhotoError("Choose an image smaller than 25 MB for this preview.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setMode("photo");
    photoPreviewUrlRef.current = nextUrl;
    setPhotoFile(file);
    setPhotoPreviewUrl(nextUrl);
    setPhotoDecodeState("decoding");
  };

  const acceptDecodedPhoto = (expectedUrl: string) => {
    if (photoPreviewUrlRef.current !== expectedUrl) return;
    setPhotoDecodeState("ready");
    setPhotoError(null);
  };

  const inspectSelectedVideo = (
    expectedUrl: string,
    video: HTMLVideoElement,
    frameReady: boolean,
  ) => {
    if (photoPreviewUrlRef.current !== expectedUrl) return;
    const { duration, videoHeight, videoWidth } = video;
    if (!Number.isFinite(duration) || duration <= 0) {
      rejectUndecodablePhoto(expectedUrl);
      setPhotoError(
        "This video's duration could not be read. Choose another one.",
      );
      return;
    }
    const durationMs = Math.ceil(duration * 1000);
    if (durationMs > maximumVideoDurationMs) {
      rejectUndecodablePhoto(expectedUrl);
      setPhotoError("Choose a video about 60 seconds or shorter.");
      return;
    }
    if (
      videoWidth <= 0 ||
      videoHeight <= 0 ||
      videoWidth * videoHeight > 9_000_000
    ) {
      rejectUndecodablePhoto(expectedUrl);
      setPhotoError("This video's picture size is not supported.");
      return;
    }
    setVideoDurationMs(durationMs);
    if (frameReady) acceptDecodedPhoto(expectedUrl);
  };

  const chooseMode = (nextMode: ComposerMode) => {
    if (mode === nextMode) {
      setChoosingMode(false);
      return;
    }
    if (
      mode &&
      isDirty &&
      !window.confirm("Discard this draft and choose another type?")
    ) {
      return;
    }
    resetDraft(nextMode);
  };

  const toggleTaggedPerson = (personId: string) => {
    setTaggedPersonIds((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId],
    );
  };

  const chooseJournalPerson = (personId: string) => {
    if (!model.journalPeople.some((person) => person.id === personId)) return;
    setJournalPersonId(personId);
    setTaggedPersonIds((current) =>
      current.filter((taggedPersonId) => taggedPersonId !== personId),
    );
  };

  const validateDraft = () => {
    if (
      (mode === "photo" || mode === "video") &&
      photoDecodeState !== "ready"
    ) {
      setPhotoError(
        photoDecodeState === "decoding"
          ? `Wait for this ${mode} to finish loading.`
          : `Choose a ${mode} for this preview.`,
      );
      photoInputRef.current?.focus();
      return;
    }
    if (mode === "thought" && !body.trim()) {
      setContentError("Write a thought before saving this moment.");
      bodyTextareaRef.current?.focus();
      return false;
    }
    if ((mode === "milestone" || mode === "location") && !title.trim()) {
      setContentError(
        mode === "milestone"
          ? "Name the milestone before saving this moment."
          : "Name the place before saving this moment.",
      );
      titleInputRef.current?.focus();
      return false;
    }
    if (mode === "bible-verse" && (!title.trim() || !body.trim())) {
      setContentError("Select a verse before saving this entry.");
      verseBookTriggerRef.current?.focus();
      return false;
    }
    setContentError(null);
    setSaveError(null);
    return true;
  };

  const saveConnectedMoment = async () => {
    if (
      saving ||
      uploadInFlightRef.current ||
      (!saveFamilyMoment && !saveWrittenMoment) ||
      !mode
    )
      return;
    let occurredAt: string | null = null;
    let occurredTimezone: string | null = null;
    if (occurredTime) {
      const localMoment = new Date(`${occurredOn}T${occurredTime}:00`);
      if (Number.isNaN(localMoment.getTime())) {
        setSaveError("Check the time and try again.");
        return;
      }
      occurredAt = localMoment.toISOString();
      occurredTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    const capturedBody = body.trim();
    const savedOccurredOn = occurredOn;
    const savedOccurredTime = occurredTime;
    const savedJournalPersonId = journalPersonId;
    const savedPlaceName = placeName;
    const savedTaggedPersonIds = [...taggedPersonIds];
    const savedJournalPerson = journalPerson;
    setSaveError(null);
    setPhotoRetryable(true);

    if (mode === "photo" || mode === "video") {
      if (
        !connectedPhotoAvailable ||
        !model.circleId ||
        !photoFile ||
        photoDecodeState !== "ready" ||
        (mode === "video" && !videoDurationMs)
      ) {
        setSaveError(`Choose the ${mode} again and try once more.`);
        return;
      }
      const common = {
        file: photoFile,
        occurredTime: savedOccurredTime,
        person: {
          id: savedJournalPersonId,
          name: savedJournalPerson.name,
          initial: savedJournalPerson.initial,
          accent: savedJournalPerson.accent,
        },
      };
      if (mode === "photo") {
        startOptimisticPhotoUpload({
          ...common,
          draft: {
            body: capturedBody,
            circleId: model.circleId,
            journalPersonId: savedJournalPersonId,
            occurredAt,
            occurredOn: savedOccurredOn,
            occurredTimezone,
            placeName: savedPlaceName,
            taggedPersonIds: savedTaggedPersonIds,
          },
        });
      } else {
        startOptimisticVideoUpload({
          ...common,
          draft: {
            body: capturedBody,
            circleId: model.circleId,
            durationMs: videoDurationMs!,
            journalPersonId: savedJournalPersonId,
            occurredAt,
            occurredOn: savedOccurredOn,
            occurredTimezone,
            placeName: savedPlaceName,
            taggedPersonIds: savedTaggedPersonIds,
          },
        });
      }
      resetDraft();
      onRequestClose();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
      router.replace("/family");
      return;
    }

    const savedMode = mode;
    const savedKind = savedMode === "bible-verse" ? "thought" : savedMode;
    const savedTitle = title.trim();
    const savedBody =
      savedMode === "bible-verse"
        ? formatBibleVerseMoment(savedTitle, capturedBody)
        : capturedBody;
    const savedResolvedPlaceName =
      savedMode === "location" ? savedTitle : savedPlaceName.trim();
    startOptimisticMomentSave({
      circleId: model.circleId ?? null,
      mode: savedMode,
      title: savedTitle,
      body: capturedBody,
      placeName: savedResolvedPlaceName,
      taggedPeopleLabel: taggedPeople.map((person) => person.name).join(", "),
      occurredOn: savedOccurredOn,
      occurredTime: savedOccurredTime,
      person: {
        name: savedJournalPerson.name,
        initial: savedJournalPerson.initial,
        accent: savedJournalPerson.accent,
      },
      save: () =>
        saveFamilyMoment
          ? saveFamilyMoment({
              journalPersonId: savedJournalPersonId,
              kind: savedKind,
              title: savedKind === "milestone" ? savedTitle : "",
              body: savedBody,
              placeName: savedResolvedPlaceName,
              taggedPersonIds: savedTaggedPersonIds,
              occurredOn: savedOccurredOn,
              occurredAt,
              occurredTimezone,
            })
          : saveWrittenMoment!({
              journalPersonId: savedJournalPersonId,
              body: savedBody,
              occurredOn: savedOccurredOn,
              occurredAt,
              occurredTimezone,
            }),
      onPublished: () => router.refresh(),
    });
    resetDraft();
    onRequestClose();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    router.replace("/family");
  };

  const submitDraft = async () => {
    if (!validateDraft()) return;
    if (connectedExperience) {
      await saveConnectedMoment();
      return;
    }

    // The disconnected design-preview route has no persistence layer. Closing
    // after validation mirrors the production one-step save interaction.
    close(true);
  };

  const stopPhotoUpload = () => {
    const controller = photoUploadAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    setPhotoUploadStage({ state: "stopping" });
    controller.abort();
  };

  const returnToEditing = () => {
    if (mode === "photo" && photoUploadAttemptRef.current) {
      photoUploadAttemptRef.current = null;
      setPhotoUploadStage(null);
    }
    if (mode === "video" && videoUploadAttemptRef.current) {
      videoUploadAttemptRef.current = null;
      setPhotoUploadStage(null);
    }
    setReviewing(false);
  };

  const photoUploadLabel =
    photoUploadStage?.state === "preparing"
      ? `Preparing your ${mode === "video" ? "video" : "photo"} privately…`
      : photoUploadStage?.state === "uploading"
        ? `Uploading… ${Math.round(photoUploadStage.progress * 100)}%`
        : photoUploadStage?.state === "stopping"
          ? "Stopping transfer and confirming cancellation…"
          : photoUploadStage?.state === "finishing"
            ? "Finishing your private upload…"
            : photoUploadStage?.state === "processing"
              ? "Photo received. Preparing it for your timeline…"
              : null;
  const photoRetryBlocked = Boolean(
    (mode === "photo" || mode === "video") && saveError && !photoRetryable,
  );

  const previewTitle = resolvePreviewTitle(
    title,
    body,
    Boolean(photoFile),
    copy?.kindLabel ?? "Moment",
  );

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`composer-dialog new-moment-composer-dialog${
        mode && !choosingMode && !reviewing ? " composer-editor-fullscreen" : ""
      }`}
      aria-labelledby="composer-title"
      aria-describedby={connectedExperience ? "composer-privacy" : undefined}
      onKeyDown={containDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="composer-sheet header-drawer-surface">
        <span className="sheet-handle" aria-hidden="true" />
        <button
          className="sheet-close header-drawer-close"
          aria-label="Close moment composer"
          disabled={saving}
          onClick={() => close()}
        >
          ×
        </button>

        {!mode || choosingMode ? (
          <>
            {connectedExperience ? (
              <span id="composer-privacy" className="private-label">
                Family only
              </span>
            ) : null}
            <h2 ref={chooserHeadingRef} id="composer-title" tabIndex={-1}>
              {mode ? "Select entry type" : "New moment"}
            </h2>
            {mode && isDirty ? (
              <p className="composer-draft-held">
                Your current draft is still here.
              </p>
            ) : null}
            <div className="moment-choices">
              {!connectedExperience || connectedPhotoAvailable ? (
                <button onClick={() => chooseMode("photo")}>
                  <span className="choice-icon photo-choice" aria-hidden="true">
                    ▣
                  </span>
                  <strong>Photo or video</strong>
                  <small>Media with date and note</small>
                </button>
              ) : null}
              <button onClick={() => chooseMode("thought")}>
                <span className="choice-icon thought-choice" aria-hidden="true">
                  “
                </span>
                <strong>Written entry</strong>
                <small>Text, date, and details</small>
              </button>
              {!connectedExperience || connectedFamily ? (
                <button onClick={() => chooseMode("bible-verse")}>
                  <span className="choice-icon bible-choice" aria-hidden="true">
                    †
                  </span>
                  <strong>Bible verse</strong>
                  <small>Choose a passage</small>
                </button>
              ) : null}
              {!connectedExperience || connectedFamily ? (
                <button onClick={() => chooseMode("location")}>
                  <span
                    className="choice-icon location-choice"
                    aria-hidden="true"
                  >
                    ⌖
                  </span>
                  <strong>Location</strong>
                  <small>A place connected to a memory</small>
                </button>
              ) : null}
            </div>
          </>
        ) : reviewing && copy ? (
          <div className="composer-review">
            <span id="composer-privacy" className="private-label">
              {connectedExperience
                ? "Family only"
                : "Design preview · Nothing was saved"}
            </span>
            <h2 ref={reviewHeadingRef} id="composer-title" tabIndex={-1}>
              Review entry
            </h2>
            <article className={`composer-preview-card preview-${mode}`}>
              {photoPreviewUrl && mode === "photo" ? (
                <div className="composer-photo-preview">
                  {/* The selected blob must bypass both Next's public optimizer
                      and its CSP-incompatible inline image style. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={photoPreviewUrl}
                    src={photoPreviewUrl}
                    alt=""
                    width={720}
                    height={540}
                    decoding="async"
                    onError={() => {
                      if (photoPreviewUrlRef.current !== photoPreviewUrl)
                        return;
                      setReviewing(false);
                      rejectUndecodablePhoto(photoPreviewUrl);
                    }}
                  />
                </div>
              ) : null}
              {photoPreviewUrl && mode === "video" ? (
                <div className="composer-photo-preview composer-video-preview">
                  <video
                    key={photoPreviewUrl}
                    src={photoPreviewUrl}
                    aria-label="Selected video preview"
                    controls
                    controlsList="nodownload noremoteplayback"
                    disablePictureInPicture
                    disableRemotePlayback
                    playsInline
                    preload="metadata"
                  />
                </div>
              ) : null}
              <div className="composer-preview-copy">
                <span>{copy.kindLabel}</span>
                <strong>{previewTitle}</strong>
                {title.trim() && body.trim() ? <p>{body.trim()}</p> : null}
              </div>
            </article>
            <dl className="composer-review-details">
              <div>
                <dt>Journal</dt>
                <dd>{journalPerson.name}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{plainDateLabel(occurredOn)}</dd>
              </div>
              {occurredTime ? (
                <div>
                  <dt>Time</dt>
                  <dd>{occurredTime}</dd>
                </div>
              ) : null}
              {taggedPeople.length ? (
                <div>
                  <dt>With</dt>
                  <dd>
                    {taggedPeople.map((person) => person.name).join(", ")}
                  </dd>
                </div>
              ) : null}
              {resolvedPlaceName.trim() && mode !== "location" ? (
                <div>
                  <dt>Place</dt>
                  <dd>{resolvedPlaceName.trim()}</dd>
                </div>
              ) : null}
            </dl>
            {journalPersonId !== model.recorderPersonId ? (
              <p className="recorded-by">Recorded by {model.recordedByName}</p>
            ) : null}
            <div className="composer-review-actions">
              {(mode === "photo" || mode === "video") &&
              saving &&
              (photoUploadStage?.state === "preparing" ||
                photoUploadStage?.state === "uploading") ? (
                <button
                  className="secondary-composer-action stop-photo-upload"
                  type="button"
                  onClick={stopPhotoUpload}
                >
                  Cancel upload
                </button>
              ) : photoRetryBlocked ? (
                <button
                  className="secondary-composer-action single-composer-action"
                  type="button"
                  onClick={returnToEditing}
                >
                  Return to {mode === "video" ? "video" : "photo"}
                </button>
              ) : (
                <>
                  <button
                    className="secondary-composer-action"
                    type="button"
                    disabled={saving}
                    onClick={returnToEditing}
                  >
                    Back to edit
                  </button>
                  <button
                    className="save-moment"
                    type="button"
                    disabled={saving}
                    onClick={
                      connectedExperience
                        ? saveConnectedMoment
                        : () => close(true)
                    }
                  >
                    {connectedExperience
                      ? saving
                        ? mode === "photo" || mode === "video"
                          ? photoUploadStage?.state === "finishing"
                            ? `Finishing ${mode}…`
                            : photoUploadStage?.state === "stopping"
                              ? `Cancelling ${mode}…`
                              : `Adding ${mode}…`
                          : "Saving…"
                        : (mode === "photo" || mode === "video") && saveError
                          ? "Try upload again"
                          : "Save moment"
                      : "Close preview"}
                  </button>
                </>
              )}
            </div>
            {(mode === "photo" || mode === "video") && photoUploadLabel ? (
              <div className="composer-upload-status" role="status">
                <p>{photoUploadLabel}</p>
                {photoUploadStage?.state === "uploading" ? (
                  <progress
                    aria-label={`Private ${mode} upload`}
                    max={1}
                    value={photoUploadStage.progress}
                  />
                ) : null}
              </div>
            ) : null}
            {saveError ? (
              <p className="composer-error" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
        ) : copy ? (
          <form
            className="quick-compose composer-fullscreen-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDraft();
            }}
          >
            <header className="composer-editor-header">
              <button
                className="composer-back"
                type="button"
                onClick={() => setChoosingMode(true)}
              >
                ← Choose another
              </button>
              <span id="composer-privacy" className="private-label">
                {copy.title}
              </span>
              <h2
                ref={editorHeadingRef}
                id="composer-title"
                className="sr-only"
                tabIndex={-1}
              >
                {copy.title}
              </h2>
            </header>

            <div className="composer-editor-scroll">
              {mode === "photo" || mode === "video" ? (
                <label className="photo-input">
                  <span>
                    {photoFile
                      ? "Choose different media"
                      : "Choose photo or video"}
                  </span>
                  <small>
                    {connectedPhotoAvailable
                      ? "The original uploads privately to this family."
                      : "It stays on this device in the preview."}
                  </small>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-m4v,video/webm"
                    required={!photoFile}
                    aria-invalid={photoError ? true : undefined}
                    aria-describedby={
                      photoError ? "photo-preview-error" : undefined
                    }
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      event.currentTarget.blur();
                      editorHeadingRef.current?.focus({ preventScroll: true });
                      replacePhoto(file);
                    }}
                  />
                </label>
              ) : null}
              {photoError ? (
                <p
                  id="photo-preview-error"
                  className="composer-error"
                  role="alert"
                >
                  {photoError}
                </p>
              ) : null}
              <p
                className="composer-selection-status"
                role="status"
                aria-live="polite"
              >
                {photoFile
                  ? photoDecodeState === "ready"
                    ? connectedPhotoAvailable
                      ? `${mode === "video" ? "Video" : "Photo"} ready to upload privately.`
                      : `${mode === "video" ? "Video" : "Photo"} ready for this local preview.`
                    : `Preparing this ${mode === "video" ? "video" : "photo"} on your device.`
                  : ""}
              </p>
              {photoPreviewUrl && mode === "photo" ? (
                <div className="composer-photo-preview">
                  {/* The selected blob is local-only and must never enter the
                    generic Next image optimizer or receive inline styles. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={photoPreviewUrl}
                    src={photoPreviewUrl}
                    alt="Selected photo preview"
                    width={720}
                    height={540}
                    decoding="async"
                    onLoad={() => acceptDecodedPhoto(photoPreviewUrl)}
                    onError={() => rejectUndecodablePhoto(photoPreviewUrl)}
                  />
                  <button type="button" onClick={() => replacePhoto(null)}>
                    Remove photo
                  </button>
                </div>
              ) : null}
              {photoPreviewUrl && mode === "video" ? (
                <div className="composer-photo-preview composer-video-preview">
                  <video
                    key={photoPreviewUrl}
                    src={photoPreviewUrl}
                    aria-label="Selected video preview"
                    controls
                    controlsList="nodownload noremoteplayback"
                    disablePictureInPicture
                    disableRemotePlayback
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) =>
                      inspectSelectedVideo(
                        photoPreviewUrl,
                        event.currentTarget,
                        false,
                      )
                    }
                    onLoadedData={(event) =>
                      inspectSelectedVideo(
                        photoPreviewUrl,
                        event.currentTarget,
                        true,
                      )
                    }
                    onError={() => {
                      rejectUndecodablePhoto(photoPreviewUrl);
                      setPhotoError(
                        "This video could not be played. Choose another one.",
                      );
                    }}
                  />
                  <button type="button" onClick={() => replacePhoto(null)}>
                    Remove video
                  </button>
                </div>
              ) : null}

              {mode === "bible-verse" ? (
                <BibleVerseFields
                  value={verseSelection}
                  bookTriggerRef={verseBookTriggerRef}
                  onChange={(next, passage) => {
                    setVerseSelection(next);
                    setTitle(passage?.reference ?? "");
                    setBody(passage?.text ?? "");
                    if (passage) setContentError(null);
                  }}
                />
              ) : null}

              {mode === "milestone" || mode === "location" ? (
                <label className="composer-field">
                  <span>
                    {mode === "milestone" ? "Milestone" : "Place name"}
                  </span>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={title}
                    required
                    aria-invalid={contentError ? true : undefined}
                    aria-describedby={
                      contentError ? "composer-content-error" : undefined
                    }
                    maxLength={120}
                    placeholder={
                      mode === "milestone"
                        ? "A meaningful first"
                        : "Somewhere worth remembering"
                    }
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (event.target.value.trim()) setContentError(null);
                    }}
                  />
                </label>
              ) : null}

              {mode === "bible-verse" ? null : (
                <label className="composer-field">
                  <span>{copy.bodyLabel}</span>
                  <textarea
                    ref={bodyTextareaRef}
                    placeholder={copy.bodyPlaceholder}
                    value={body}
                    required={copy.bodyRequired}
                    aria-invalid={
                      mode === "thought" && contentError ? true : undefined
                    }
                    aria-describedby={
                      mode === "thought" && contentError
                        ? "composer-content-error"
                        : undefined
                    }
                    maxLength={4000}
                    onChange={(event) => {
                      setBody(event.target.value);
                      if (mode === "thought" && event.target.value.trim()) {
                        setContentError(null);
                      }
                    }}
                  />
                </label>
              )}
              {contentError ? (
                <p
                  id="composer-content-error"
                  className="composer-error"
                  role="alert"
                >
                  {contentError}
                </p>
              ) : null}

              <div className="composer-core-fields">
                <DateTimeFields
                  date={occurredOn}
                  maxDate={model.previewToday}
                  time={occurredTime}
                  onDateChange={setOccurredOn}
                  onTimeChange={setOccurredTime}
                />
              </div>

              <div className="composer-optional">
                <button
                  className="composer-optional-toggle"
                  type="button"
                  aria-expanded={optionalDetailsOpen}
                  aria-controls="composer-optional-fields"
                  onClick={() => setOptionalDetailsOpen((current) => !current)}
                >
                  Details <span>Optional</span>
                </button>
                {optionalDetailsOpen ? (
                  <div id="composer-optional-fields">
                    <JournalPickerField
                      options={model.journalPeople}
                      value={journalPersonId}
                      onChange={chooseJournalPerson}
                    />
                    <fieldset className="people-tags">
                      <legend>Who else was part of this?</legend>
                      <div>
                        {model.taggablePeople
                          .filter(
                            (person) =>
                              !connectedExperience ||
                              person.id !== journalPersonId,
                          )
                          .map((person) => {
                            const isPreviewJournalPerson =
                              !connectedExperience &&
                              person.id === journalPersonId;
                            return (
                              <label key={person.id}>
                                <input
                                  type="checkbox"
                                  checked={taggedPersonIds.includes(person.id)}
                                  disabled={isPreviewJournalPerson}
                                  onChange={() => toggleTaggedPerson(person.id)}
                                />
                                <span
                                  className={`tag-person-dot dot-${person.accent}`}
                                  aria-hidden="true"
                                >
                                  {person.initial}
                                </span>
                                {person.name}
                              </label>
                            );
                          })}
                      </div>
                    </fieldset>
                    {mode !== "location" ? (
                      <label className="composer-field">
                        <span>Place</span>
                        <input
                          type="text"
                          value={placeName}
                          maxLength={160}
                          placeholder="Add a place by hand"
                          onChange={(event) => setPlaceName(event.target.value)}
                        />
                        <small>No location is read from your media.</small>
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {journalPersonId !== model.recorderPersonId ? (
                <p className="recorded-by">
                  Recorded by {model.recordedByName}
                </p>
              ) : null}
              {connectedExperience ? (
                <p className="composer-preview-note">
                  This will appear in its true chronological place.
                </p>
              ) : null}
            </div>

            <footer className="composer-editor-footer">
              <button
                className="save-moment"
                type="submit"
                disabled={saving || photoRetryBlocked}
              >
                {saving
                  ? mode === "photo" || mode === "video"
                    ? photoUploadStage?.state === "finishing"
                      ? `Finishing ${mode}…`
                      : `Adding ${mode}…`
                    : "Saving…"
                  : photoRetryBlocked
                    ? "Upload unavailable"
                    : (mode === "photo" || mode === "video") && saveError
                      ? "Try upload again"
                      : "Save"}
              </button>
              {(mode === "photo" || mode === "video") &&
              saving &&
              (photoUploadStage?.state === "preparing" ||
                photoUploadStage?.state === "uploading") ? (
                <button
                  className="secondary-composer-action stop-photo-upload"
                  type="button"
                  onClick={stopPhotoUpload}
                >
                  Cancel upload
                </button>
              ) : null}
              {(mode === "photo" || mode === "video") && photoUploadLabel ? (
                <div className="composer-upload-status" role="status">
                  <p>{photoUploadLabel}</p>
                  {photoUploadStage?.state === "uploading" ? (
                    <progress
                      aria-label={`Private ${mode} upload`}
                      max={1}
                      value={photoUploadStage.progress}
                    />
                  ) : null}
                </div>
              ) : null}
              {saveError ? (
                <p className="composer-error" role="alert">
                  {saveError}
                </p>
              ) : null}
            </footer>
          </form>
        ) : null}
      </section>
    </dialog>
  );
}
