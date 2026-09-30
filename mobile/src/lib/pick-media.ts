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

/** The iOS file-input menu, in the order WebKit shows it. */
export const mediaMenuOptions = [
  "Photo Library",
  "Take Photo or Video",
  "Choose Files",
] as const;

export type MediaSource = "library" | "camera" | "files";

const maximumVideoDurationMs = 120_500;

export function mediaSourceForMenuIndex(index: number): MediaSource | null {
  if (index === 0) return "library";
  if (index === 1) return "camera";
  if (index === 2) return "files";
  return null;
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
}>;

async function readUri(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("That photo could not be read.");
  return response.arrayBuffer();
}

function videoDurationMs(file: File) {
  const doc = globalThis.document;
  if (!doc) return Promise.resolve(null);
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = doc.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const ms = Math.round(video.duration * 1000);
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Choose a video about 2 minutes or shorter."));
    };
    video.src = url;
  });
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

function pickOnWeb(camera: boolean) {
  const doc = globalThis.document;
  if (!doc) {
    return Promise.reject(new Error("That photo could not be read."));
  }
  return new Promise<PickedMedia | null>((resolve, reject) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = webAccept;
    if (camera) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file
        .arrayBuffer()
        .then(async (bytes) => {
          const video = file.type.startsWith("video/");
          const durationMs = video ? await videoDurationMs(file) : null;
          resolve({
            bytes,
            mimeType: file.type || (video ? "video/mp4" : "image/jpeg"),
            name: file.name,
            kind: video ? "video" : "photo",
            durationMs,
          });
        })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error("That photo could not be read."));
        });
    };
    input.click();
  });
}

async function pickDocument(): Promise<PickedMedia | null> {
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: [...acceptedTypes],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const bytes = await readUri(asset.uri);
  const mimeType = asset.mimeType || mimeFromName(asset.name);
  const video = mimeType.startsWith("video/");
  if (!video && !mimeType.startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG, or WebP photo, or an MP4, MOV, M4V, or WebM video.");
  }
  const durationMs = video ? mp4DurationMs(new Uint8Array(bytes)) : null;
  if (video) assertVideoLength(durationMs);
  return {
    bytes,
    mimeType,
    name: asset.name,
    kind: video ? "video" : "photo",
    durationMs,
  };
}

/** Library, camera, or Files. Photos and videos use the web’s size and length limits. */
export async function pickJournalMedia(source: MediaSource): Promise<PickedMedia | null> {
  if (typeof document !== "undefined" && navigator.product !== "ReactNative") {
    return pickOnWeb(source === "camera");
  }
  if (source === "files") return pickDocument();
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
    // Web allows 120.5s. The picker limit is whole seconds, so the byte check is exact.
    videoMaxDuration: 121,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const video = asset.type === "video" || asset.mimeType?.startsWith("video/") === true;
  const bytes = await readUri(asset.uri);
  const durationMs = video && typeof asset.duration === "number" ? Math.round(asset.duration) : null;
  if (video) assertVideoLength(durationMs);
  return {
    bytes,
    mimeType: asset.mimeType || (video ? "video/mp4" : "image/jpeg"),
    name: asset.fileName || (video ? "video.mp4" : "photo.jpg"),
    kind: video ? "video" : "photo",
    durationMs,
  };
}
