import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndependentOverlayPhoto } from "./independent-overlay-photo";

const asset =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

describe("IndependentOverlayPhoto", () => {
  afterEach(() => {
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
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

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

  it("revokes the object URL when the overlay unmounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["overlay-bytes"], { type: "image/gif" }),
      })),
    );
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:independent-overlay",
    );

    const view = render(
      <IndependentOverlayPhoto src={asset} alt="Overlay porch" />,
    );
    await screen.findByRole("img", { name: "Overlay porch" });
    view.unmount();

    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith("blob:independent-overlay");
    });
  });
});
