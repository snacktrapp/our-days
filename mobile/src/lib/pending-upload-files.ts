import { Directory, File, Paths } from "expo-file-system";

import type { PendingStorage, PendingUpload } from "./pending-uploads";

/**
 * iOS: uploads that have not finished keep their bytes in the app's documents
 * folder, so a failed upload still has Retry after the app is closed (the web
 * keeps them in IndexedDB, #148). One folder per signed-in account.
 */
export function pendingFileStorage(userId: string): PendingStorage {
  const root = new Directory(Paths.document, "pending-uploads", userId.replace(/[^a-z0-9-]/giu, ""));
  const ensure = (dir: Directory) => {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
  };
  const jobDir = (jobId: string) => new Directory(root, jobId.replace(/[^a-z0-9-]/giu, ""));
  const index = () => new File(ensure(root), "index.json");

  return {
    async save(jobs: readonly PendingUpload[]) {
      index().write(JSON.stringify(jobs));
    },
    async load() {
      const file = index();
      if (!file.exists) return [];
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!Array.isArray(parsed)) return [];
      return (parsed as PendingUpload[]).filter((job) => {
        const dir = jobDir(job.id);
        return dir.exists && job.media.every((_, i) => new File(dir, `${i}.bin`).exists);
      });
    },
    async putBytes(jobId, i, payload) {
      const dir = ensure(jobDir(jobId));
      const file = new File(dir, `${i}.bin`);
      file.write(new Uint8Array(payload.bytes));
      let posterUri: string | null = null;
      if (payload.poster) {
        const poster = new File(dir, `${i}-poster.jpg`);
        poster.write(new Uint8Array(payload.poster.bytes));
        new File(dir, `${i}-poster.json`).write(
          JSON.stringify({ width: payload.poster.width, height: payload.poster.height }),
        );
        posterUri = poster.uri;
      }
      return { uri: file.uri, posterUri };
    },
    async readBytes(jobId, i) {
      const dir = jobDir(jobId);
      const file = new File(dir, `${i}.bin`);
      if (!file.exists) return null;
      const bytes = await file.arrayBuffer();
      const poster = new File(dir, `${i}-poster.jpg`);
      const size = new File(dir, `${i}-poster.json`);
      if (!poster.exists || !size.exists) return { bytes, poster: null };
      const { width, height } = JSON.parse(await size.text()) as { width: number; height: number };
      return { bytes, poster: { bytes: await poster.arrayBuffer(), width, height, uri: poster.uri } };
    },
    async drop(jobId) {
      const dir = jobDir(jobId);
      if (dir.exists) dir.delete();
    },
  };
}
