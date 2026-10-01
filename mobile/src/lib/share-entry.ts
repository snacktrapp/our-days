/**
 * What a share from another app becomes before the person picks a circle.
 * The iOS share extension only hands the payload to the app; posting uses the
 * existing photo, video, and written-moment paths.
 */

export type ShareFile = Readonly<{
  path: string;
  mimeType?: string | null;
  fileName?: string | null;
  duration?: number | null;
}>;

export type SharePayload = Readonly<{
  text?: string | null;
  webUrl?: string | null;
  type?: string | null;
  files?: readonly ShareFile[] | null;
}>;

export type ShareDraft =
  | Readonly<{ kind: "photo"; path: string; mimeType: string; name: string }>
  | Readonly<{
      kind: "video";
      path: string;
      mimeType: string;
      name: string;
      durationMs: number;
    }>
  | Readonly<{ kind: "link"; url: string }>
  | Readonly<{ kind: "text"; text: string }>;

const videoMimes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);

function videoMime(mimeType: string, name: string) {
  const normalized = mimeType.trim().toLowerCase();
  if (videoMimes.has(normalized)) return normalized;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  if (extension === "m4v") return "video/x-m4v";
  if (extension === "webm") return "video/webm";
  return null;
}

function imageMime(mimeType: string, name: string) {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.startsWith("image/")) return normalized;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "jpg" || extension === "jpeg" || extension === "heic") return "image/jpeg";
  return null;
}

/** Share-intent duration is milliseconds when it is already a long count. */
export function shareDurationMs(duration: number | null | undefined) {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return 1000;
  }
  if (duration > 1000) return Math.round(duration);
  return Math.round(duration * 1000);
}

export function draftFromShareIntent(payload: SharePayload): ShareDraft | null {
  const file = payload.files?.find((item) => item.path);
  if (file) {
    const name = file.fileName?.trim() || "Shared";
    const mime = file.mimeType ?? "";
    const video = videoMime(mime, name);
    if (video || mime.startsWith("video/")) {
      return {
        kind: "video",
        path: file.path,
        mimeType: video ?? "video/mp4",
        name,
        durationMs: shareDurationMs(file.duration),
      };
    }
    const image = imageMime(mime, name);
    if (image || mime.startsWith("image/") || payload.type === "media") {
      return {
        kind: "photo",
        path: file.path,
        mimeType: image ?? "image/jpeg",
        name,
      };
    }
  }
  const url = payload.webUrl?.trim();
  if (url && /^https?:\/\//iu.test(url)) return { kind: "link", url };
  const text = payload.text?.trim();
  if (text && /^https?:\/\/\S+$/iu.test(text)) return { kind: "link", url: text };
  if (text) return { kind: "text", text: text.slice(0, 4000) };
  return null;
}

export function shareDraftLabel(draft: ShareDraft) {
  if (draft.kind === "photo") return "Shared photo";
  if (draft.kind === "video") return "Shared video";
  if (draft.kind === "link") return draft.url;
  return draft.text;
}

/** A share is posted into one chosen circle. An empty id is not a choice. */
export function shareCircleChosen(circleId: string | null | undefined) {
  return Boolean(circleId && circleId.trim());
}
