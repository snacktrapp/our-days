import { captureDeviceVideoPoster, type VideoPoster } from "./video-poster";

const webAccept =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-m4v,video/webm";

const acceptedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
] as const;

/**
 * The photo chooser, in the order the web file input shows it.
 * `symbol` is the SF Symbol on the iOS pull-down menu.
 */
export const mediaMenuItems = [
  { id: "library", title: "Photo Library", symbol: "photo.on.rectangle" },
  { id: "camera", title: "Take Photo or Video", symbol: "camera" },
  { id: "files", title: "Choose Files", symbol: "folder" },
] as const;

export type MediaSource = (typeof mediaMenuItems)[number]["id"];

export const mediaMenuOptions = mediaMenuItems.map((item) => item.title);

const maximumVideoDurationMs = 120_500;

export function mediaSourceForMenuIndex(index: number): MediaSource | null {
  return mediaMenuItems[index]?.id ?? null;
}

export function mediaSourceForMenuId(id: string): MediaSource | null {
  return mediaMenuItems.find((item) => item.id === id)?.id ?? null;
}

/**
 * The pull-down menu needs the ExpoUI native module from the runtime 0.6.0
 * build. Runtime 0.5.0 does not have it, so an over-the-air update keeps the
 * action sheet.
 */
export function usesNativeMediaMenu(platform: string, nativeModulePresent: boolean) {
  return platform === "ios" && nativeModulePresent;
}

/**
 * Duration from an MP4/MOV/M4V `mvhd` box. Choose Files does not report a
 * length the way the photo library does.
 */
export function mp4DurationMs(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const limit = Math.min(bytes.length - 24, 8_000_000);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] !== 0x6d ||
      bytes[index + 1] !== 0x76 ||
      bytes[index + 2] !== 0x68 ||
      bytes[index + 3] !== 0x64
    ) {
      continue;
    }
    const version = bytes[index + 4];
    if (version === 0) {
      const timescale = view.getUint32(index + 16);
      const duration = view.getUint32(index + 20);
      if (timescale > 0) return Math.round((duration / timescale) * 1000);
    }
    if (version === 1 && index + 36 < bytes.length) {
      const timescale = view.getUint32(index + 24);
      const duration = view.getUint32(index + 28) * 2 ** 32 + view.getUint32(index + 32);
      if (timescale > 0) return Math.round((duration / timescale) * 1000);
    }
  }
  return null;
}

export type PickedMedia = Readonly<{
  bytes: ArrayBuffer;
  mimeType: string;
  name: string;
  kind: "photo" | "video";
  durationMs: number | null;
  /** File or blob URL the tile can draw. */
  previewUri: string;
  /** A still of the first video frame, when this platform can make one. */
  posterUri: string | null;
  /** JPEG bytes to store as the moment poster after the video upload. */
  poster: VideoPoster | null;
}>;

export const maximumMomentPhotos = 6;

/** `0:09`, `1:05`. Null when the length was not reported. */
export function formatMediaDuration(durationMs: number | null) {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const total = Math.round(durationMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function releasePreview(item: PickedMedia) {
  for (const uri of [item.previewUri, item.posterUri]) {
    if (uri?.startsWith("blob:")) URL.revokeObjectURL(uri);
  }
}

async function readUri(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("That photo could not be read.");
  return response.arrayBuffer();
}

function captureVideoPreview(file: File) {
  const doc = globalThis.document;
  if (!doc) {
    return Promise.reject(new Error("Choose a video about 2 minutes or shorter."));
  }
  const previewUri = URL.createObjectURL(file);
  return new Promise<{
    durationMs: number;
    posterUri: string | null;
    previewUri: string;
    poster: VideoPoster | null;
  }>((resolve, reject) => {
      const video = doc.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      const finish = (durationMs: number) => {
        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        if (width < 2 || height < 2) {
          resolve({ durationMs, posterUri: null, previewUri, poster: null });
          return;
        }
        const scale = Math.min(1, 720 / width);
        const canvas = doc.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        try {
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob || blob.size < 2_500) {
              resolve({ durationMs, posterUri: null, previewUri, poster: null });
              return;
            }
            void blob.arrayBuffer().then((bytes) => {
              resolve({
                durationMs,
                posterUri: URL.createObjectURL(blob),
                previewUri,
                poster: { bytes, width: canvas.width, height: canvas.height, uri: null },
              });
            });
          }, "image/jpeg", 0.72);
        } catch {
          resolve({ durationMs, posterUri: null, previewUri, poster: null });
        }
      };
      video.onloadeddata = () => {
        const durationMs = Math.round((Number.isFinite(video.duration) ? video.duration : 0) * 1000);
        if (video.duration > 0.4) {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            finish(durationMs);
          };
          video.addEventListener("seeked", onSeeked);
          try {
            video.currentTime = 0.2;
            return;
          } catch {
            video.removeEventListener("seeked", onSeeked);
          }
        }
        finish(durationMs);
      };
      video.onerror = () => {
        URL.revokeObjectURL(previewUri);
        reject(new Error("Choose a video about 2 minutes or shorter."));
      };
      video.src = previewUri;
    },
  );
}

function mimeFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function assertVideoLength(durationMs: number | null) {
  if (durationMs == null) {
    throw new Error("This video's duration could not be read. Choose another one.");
  }
  if (durationMs < 1 || durationMs > maximumVideoDurationMs) {
    throw new Error("Choose a video about 2 minutes or shorter.");
  }
}

async function mediaFromFile(file: File): Promise<PickedMedia> {
  const video = file.type.startsWith("video/") || mimeFromName(file.name).startsWith("video/");
  const bytes = await file.arrayBuffer();
  if (video) {
    const preview = await captureVideoPreview(file);
    assertVideoLength(preview.durationMs);
    return {
      bytes,
      mimeType: file.type || "video/mp4",
      name: file.name,
      kind: "video",
      durationMs: preview.durationMs,
      previewUri: preview.previewUri,
      posterUri: preview.posterUri,
      poster: preview.poster,
    };
  }
  return {
    bytes,
    mimeType: file.type || "image/jpeg",
    name: file.name,
    kind: "photo",
    durationMs: null,
    previewUri: URL.createObjectURL(file),
    posterUri: null,
    poster: null,
  };
}

function pickOnWeb(camera: boolean, multiple: boolean, limit: number) {
  const doc = globalThis.document;
  if (!doc) {
    return Promise.reject(new Error("That photo could not be read."));
  }
  return new Promise<readonly PickedMedia[]>((resolve, reject) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = webAccept;
    input.multiple = multiple && !camera;
    if (camera) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const files = [...(input.files ?? [])].slice(0, Math.max(1, limit));
      if (files.length === 0) {
        resolve([]);
        return;
      }
      const hasVideo = files.some((file) => file.type.startsWith("video/"));
      const hasPhoto = files.some((file) => !file.type.startsWith("video/"));
      if (hasVideo && hasPhoto) {
        reject(new Error("Choose photos or a video, not both."));
        return;
      }
      void Promise.all(files.map((file) => mediaFromFile(file)))
        .then(resolve)
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error("That photo could not be read."));
        });
    };
    input.click();
  });
}

async function itemFromAsset(asset: {
  uri: string;
  name: string;
  mimeType?: string | null;
  durationMs: number | null;
  video: boolean;
}): Promise<PickedMedia> {
  const bytes = await readUri(asset.uri);
  const mimeType = asset.mimeType || (asset.video ? "video/mp4" : "image/jpeg");
  const durationMs = asset.video ? (asset.durationMs ?? mp4DurationMs(new Uint8Array(bytes))) : null;
  if (asset.video) assertVideoLength(durationMs);
  if (!asset.video && !mimeType.startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG, or WebP photo, or an MP4, MOV, M4V, or WebM video.");
  }
  const poster = asset.video ? await captureDeviceVideoPoster(asset.uri) : null;
  return {
    bytes,
    mimeType,
    name: asset.name,
    kind: asset.video ? "video" : "photo",
    durationMs,
    previewUri: asset.uri,
    posterUri: poster?.uri ?? null,
    poster,
  };
}

async function pickDocument(multiple: boolean, limit: number): Promise<readonly PickedMedia[]> {
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: [...acceptedTypes],
    copyToCacheDirectory: true,
    multiple,
  });
  if (result.canceled || result.assets.length === 0) return [];
  const assets = result.assets.slice(0, Math.max(1, limit));
  const items = await Promise.all(
    assets.map((asset) => {
      const mimeType = asset.mimeType || mimeFromName(asset.name);
      return itemFromAsset({
        uri: asset.uri,
        name: asset.name,
        mimeType,
        durationMs: null,
        video: mimeType.startsWith("video/"),
      });
    }),
  );
  if (items.some((item) => item.kind === "video") && items.some((item) => item.kind === "photo")) {
    for (const item of items) releasePreview(item);
    throw new Error("Choose photos or a video, not both.");
  }
  return items;
}

/** Library, camera, or Files. Photos and videos use the web’s size and length limits. */
export async function pickJournalMediaList(
  source: MediaSource,
  options?: Readonly<{ multiple?: boolean; limit?: number }>,
): Promise<readonly PickedMedia[]> {
  const multiple = options?.multiple === true && source !== "camera";
  const limit = Math.max(1, Math.min(options?.limit ?? (multiple ? maximumMomentPhotos : 1), maximumMomentPhotos));
  if (typeof document !== "undefined" && navigator.product !== "ReactNative") {
    return pickOnWeb(source === "camera", multiple, limit);
  }
  if (source === "files") return pickDocument(multiple, limit);
  const ImagePicker = await import("expo-image-picker");
  const camera = source === "camera";
  if (camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error("The camera is needed to take a photo or video.");
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Photo library access is needed to choose a picture or video.");
    }
  }
  const launch = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await launch({
    mediaTypes: ["images", "videos"],
    quality: 1,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? limit : 1,
    // Web allows 120.5s. The picker limit is whole seconds, so the byte check is exact.
    videoMaxDuration: 121,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return [];
  const items = await Promise.all(
    result.assets.slice(0, limit).map((asset) => {
      const video = asset.type === "video" || asset.mimeType?.startsWith("video/") === true;
      return itemFromAsset({
        uri: asset.uri,
        name: asset.fileName || (video ? "video.mp4" : "photo.jpg"),
        mimeType: asset.mimeType,
        durationMs: video && typeof asset.duration === "number" ? Math.round(asset.duration) : null,
        video,
      });
    }),
  );
  if (items.some((item) => item.kind === "video") && items.some((item) => item.kind === "photo")) {
    for (const item of items) releasePreview(item);
    throw new Error("Choose photos or a video, not both.");
  }
  return items;
}

export async function pickJournalMedia(source: MediaSource): Promise<PickedMedia | null> {
  const items = await pickJournalMediaList(source, { multiple: false, limit: 1 });
  return items[0] ?? null;
}
