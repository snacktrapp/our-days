import { describe, expect, it, vi } from "vitest";
import {
  incrementalPhotoSha256,
  photoHashChunkBytes,
} from "./photo-hash-algorithm";

describe("incremental private photo hashing", () => {
  it("matches the canonical SHA-256 vector without reading the whole File", async () => {
    const file = new File(["abc"], "private.jpg", { type: "image/jpeg" });
    const wholeFileRead = vi
      .spyOn(file, "arrayBuffer")
      .mockRejectedValue(new Error("whole-file reads are forbidden"));

    await expect(incrementalPhotoSha256(file)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(wholeFileRead).not.toHaveBeenCalled();
  });

  it("uses bounded chunks and monotonic progress for a large iPhone-sized file", async () => {
    const bytes = new Uint8Array(photoHashChunkBytes * 2 + 17);
    bytes.fill(7);
    const file = new File([bytes], "private.jpg", { type: "image/jpeg" });
    const originalSlice = file.slice.bind(file);
    const slice = vi.spyOn(file, "slice").mockImplementation(originalSlice);
    const progress: number[] = [];

    const digest = await incrementalPhotoSha256(file, (value) =>
      progress.push(value),
    );

    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(slice).toHaveBeenCalledTimes(3);
    for (const [, end] of slice.mock.calls) {
      expect(Number(end)).toBeLessThanOrEqual(file.size);
    }
    expect(progress).toEqual([
      photoHashChunkBytes / file.size,
      (photoHashChunkBytes * 2) / file.size,
      1,
    ]);
  });
});
