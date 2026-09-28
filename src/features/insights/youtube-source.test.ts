import { describe, expect, it } from "vitest";
import {
  youtubeEmbedSrc,
  youtubePlaybackFromSource,
  youtubeThumbnailUrl,
} from "./youtube-source";

describe("YouTube playback from a stored source URL", () => {
  it("reads the watch id and an integer start, including the s suffix", () => {
    expect(
      youtubePlaybackFromSource(
        "https://www.youtube.com/watch?v=NYFGCESmikA&list=PLtoolong&t=6747s",
      ),
    ).toEqual({ id: "NYFGCESmikA", start: 6747 });
    expect(youtubeEmbedSrc({ id: "NYFGCESmikA", start: 6747 })).toBe(
      "https://www.youtube-nocookie.com/embed/NYFGCESmikA?start=6747&autoplay=1&playsinline=1&rel=0",
    );
    expect(youtubeThumbnailUrl("NYFGCESmikA", "hqdefault")).toBe(
      "https://i.ytimg.com/vi/NYFGCESmikA/hqdefault.jpg",
    );
  });

  it("accepts youtu.be and a clock-style start", () => {
    expect(
      youtubePlaybackFromSource("https://youtu.be/abcdefghijk?t=1h2m3s"),
    ).toEqual({ id: "abcdefghijk", start: 3723 });
    expect(
      youtubePlaybackFromSource(
        "https://m.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
      ),
    ).toEqual({ id: "nm1TxQj9IsQ", start: 120 });
  });

  it("ignores other hosts, embed paths, and short ids", () => {
    expect(
      youtubePlaybackFromSource(
        "https://www.youtube.com/embed/NYFGCESmikA?start=10",
      ),
    ).toBeNull();
    expect(
      youtubePlaybackFromSource(
        "https://evil.example/watch?v=NYFGCESmikA&t=10",
      ),
    ).toBeNull();
    expect(
      youtubePlaybackFromSource("https://www.youtube.com/watch?v=short"),
    ).toBeNull();
    expect(
      youtubePlaybackFromSource("https://hubermanlab.com/sleep"),
    ).toBeNull();
    expect(
      youtubePlaybackFromSource("https://ebible.org/engwebp/PSA023.htm"),
    ).toBeNull();
    expect(youtubeThumbnailUrl("short", "hqdefault")).toBeNull();
    expect(youtubeEmbedSrc({ id: "../etc/passwd", start: 1 })).toBeNull();
  });
});
