import { incrementalPhotoSha256 } from "./photo-hash-algorithm";

type HashRequest = Readonly<{ id: string; file: File }>;

self.addEventListener("message", (event: MessageEvent<HashRequest>) => {
  const { id, file } = event.data;
  void (async () => {
    try {
      const sha256 = await incrementalPhotoSha256(file, (progress) => {
        self.postMessage({
          id,
          ok: true,
          progress,
        });
      });
      self.postMessage({ id, ok: true, sha256 });
    } catch {
      self.postMessage({ id, ok: false });
    }
  })();
});

export {};
