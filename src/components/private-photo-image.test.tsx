// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivatePhotoImage } from "./private-photo-image";

describe("PrivatePhotoImage", () => {
  it("uses the authenticated route directly and exposes truthful alt text", () => {
    render(
      <PrivatePhotoImage
        src="/api/media/moments/one"
        alt="Photo in Molly’s journal from Aug 1, 2026"
        width={1200}
        height={800}
        highPriority
      />,
    );
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "/api/media/moments/one");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute(
      "alt",
      "Photo in Molly’s journal from Aug 1, 2026",
    );
  });

  it("shows a stable retry control after a private response fails", () => {
    render(
      <PrivatePhotoImage
        src="/api/media/moments/one"
        alt="Photo in Molly’s journal"
        width={1200}
        height={800}
      />,
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("This photo couldn’t be opened.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/media/moments/one",
    );
  });
});
