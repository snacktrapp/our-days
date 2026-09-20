import { afterEach, expect, it, vi } from "vitest";
import {
  clearPrivateMediaMemory,
  privateMediaGeneration,
  readPrivateMedia,
  rememberPrivateMedia,
} from "./private-media-memory";
afterEach(() => {
  clearPrivateMediaMemory();
  vi.useRealTimers();
});

it("expires images after a minute and bounds retained images", () => {
  vi.useFakeTimers();
  const blob = new Blob(["image"], { type: "image/webp" });
  const generation = privateMediaGeneration();
  for (let i = 0; i < 25; i++)
    rememberPrivateMedia(String(i), blob, generation);
  expect(readPrivateMedia("0")).toBeUndefined();
  expect(readPrivateMedia("24")).toBe(blob);
  vi.advanceTimersByTime(60_000);
  expect(readPrivateMedia("24")).toBeUndefined();
});

it("does not cache large files or downloads completed after sign out", () => {
  const generation = privateMediaGeneration();
  rememberPrivateMedia(
    "large",
    new Blob([new Uint8Array(17 * 1024 * 1024)], { type: "image/webp" }),
    generation,
  );
  expect(readPrivateMedia("large")).toBeUndefined();
  clearPrivateMediaMemory();
  rememberPrivateMedia(
    "late",
    new Blob(["image"], { type: "image/webp" }),
    generation,
  );
  expect(readPrivateMedia("late")).toBeUndefined();
});
