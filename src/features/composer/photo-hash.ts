type HashResponse =
  | Readonly<{
      id: string;
      ok: true;
      progress?: number;
      sha256?: string;
    }>
  | Readonly<{ id: string; ok: false }>;

export function hashPhotoInWorker(
  file: File,
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(
      new URL("./photo-hash.worker.ts", import.meta.url),
      {
        name: "our-days-photo-hash",
        type: "module",
      },
    );
    const id = crypto.randomUUID();
    const stop = () => worker.terminate();
    const abort = () => {
      stop();
      reject(
        new DOMException("Photo preparation was cancelled.", "AbortError"),
      );
    };

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<HashResponse>) => {
      if (event.data.id !== id) return;
      if (event.data.ok && event.data.progress !== undefined) {
        onProgress?.(event.data.progress);
        return;
      }
      signal.removeEventListener("abort", abort);
      stop();
      if (event.data.ok && event.data.sha256) resolve(event.data.sha256);
      else reject(new Error("Photo preparation failed."));
    });
    worker.addEventListener(
      "error",
      () => {
        signal.removeEventListener("abort", abort);
        stop();
        reject(new Error("Photo preparation failed."));
      },
      { once: true },
    );
    worker.postMessage({ id, file });
  });
}
