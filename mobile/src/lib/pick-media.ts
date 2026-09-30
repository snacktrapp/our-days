const webAccept =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-m4v,video/webm";

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

function pickOnWeb(camera: boolean) {
  const doc = globalThis.document;
  if (!doc) {
    return Promise.reject(
      new Error("Photo library and camera need the Our Days 0.3.0 TestFlight build."),
    );
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

/** Library or camera. Photos and videos, with the web’s size and length limits applied after. */
export async function pickJournalMedia(camera: boolean): Promise<PickedMedia | null> {
  if (typeof document !== "undefined" && navigator.product !== "ReactNative") {
    return pickOnWeb(camera);
  }
  const ImagePicker = await import("expo-image-picker");
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
  return {
    bytes,
    mimeType: asset.mimeType || (video ? "video/mp4" : "image/jpeg"),
    name: asset.fileName || (video ? "video.mp4" : "photo.jpg"),
    kind: video ? "video" : "photo",
    durationMs: video && typeof asset.duration === "number" ? Math.round(asset.duration) : null,
  };
}
