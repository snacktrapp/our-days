import { sha256 } from "@noble/hashes/sha2.js";

export const photoHashChunkBytes = 1024 * 1024;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function incrementalPhotoSha256(
  file: File,
  onProgress?: (progress: number) => void,
) {
  const hash = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + photoHashChunkBytes, file.size);
    hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    offset = end;
    onProgress?.(offset / file.size);
  }
  return toHex(hash.digest());
}
