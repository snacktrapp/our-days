import { describe, expect, it } from "vitest";
import { foundSpotUrl } from "./found-types";

const quote =
  "The pursuit of excellence deserves no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";

describe("Found open link", () => {
  it("keeps a YouTube timestamp and adds a text fragment on a page", () => {
    const youtube = "https://www.youtube.com/watch?v=NYFGCESmikA&t=6747";
    expect(foundSpotUrl(youtube, quote)).toBe(youtube);
    const page = foundSpotUrl("https://lexfridman.com/dhh-2-transcript", quote);
    expect(
      page.startsWith("https://lexfridman.com/dhh-2-transcript#:~:text="),
    ).toBe(true);
    expect(page).toContain("The%20pursuit%20of%20excellence");
    expect(page).toContain("no%20need%20for%20justification");
    expect(page).not.toContain("Source");
  });
});
