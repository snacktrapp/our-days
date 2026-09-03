import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IndependentOverlayPhoto,
  resetIndependentOverlayObjectUrlCache,
} from "./independent-overlay-photo";

const asset = "/private-photo-overlay.jpg";

describe("IndependentOverlayPhoto", () => {
  afterEach(() => {
    resetIndependentOverlayObjectUrlCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a blob URL instead of the asset URL the card already uses", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(asset);
      return {
        ok: true,
        blob: async () => new Blob(["overlay-bytes"], { type: "image/gif" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:independent-overlay",
    );

    render(<IndependentOverlayPhoto src={asset} alt="Overlay porch" />);

    const overlay = await screen.findByRole("img", { name: "Overlay porch" });
    expect(overlay).toHaveAttribute("src", "blob:independent-overlay");
    expect(overlay).not.toHaveAttribute("src", asset);
    expect(fetchMock).toHaveBeenCalledWith(
      asset,
      expect.objectContaining({
        cache: "force-cache",
        credentials: "same-origin",
      }),
    );
  });
});
