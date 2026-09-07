import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearVideoPosters,
  peekVideoPoster,
  rememberVideoPoster,
  useVideoPoster,
} from "./video-poster-store";

const poster =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIhwgMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD//2Q==";

beforeEach(() => {
  window.sessionStorage.clear();
  clearVideoPosters();
});

afterEach(() => {
  clearVideoPosters();
  window.sessionStorage.clear();
});

describe("video poster store", () => {
  it("remembers a JPEG poster for the published moment", () => {
    rememberVideoPoster("moment-1", poster);
    expect(peekVideoPoster("moment-1")).toBe(poster);
    expect(
      window.sessionStorage.getItem("our-days:video-poster:moment-1"),
    ).toBe(poster);
  });

  it("ignores non-image data", () => {
    rememberVideoPoster("moment-1", "https://example.test/poster.jpg");
    expect(peekVideoPoster("moment-1")).toBeNull();
  });

  it("clears cached posters with private state", () => {
    rememberVideoPoster("moment-1", poster);
    window.dispatchEvent(new Event("our-days:clear-private-state"));
    expect(peekVideoPoster("moment-1")).toBeNull();
  });

  it("notifies cards when a poster arrives", async () => {
    const { result } = renderHook(() => useVideoPoster("moment-1"));
    expect(result.current).toBeNull();
    rememberVideoPoster("moment-1", poster);
    await waitFor(() => expect(result.current).toBe(poster));
  });
});
