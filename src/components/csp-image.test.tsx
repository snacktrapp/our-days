import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CspPublicImage } from "./csp-image";

const imageProps = {
  src: "/sample-family.jpg",
  alt: "A family memory",
  width: 1200,
  height: 801,
  sizes: "92vw",
  highPriority: true,
} as const;

describe("CspPublicImage", () => {
  it("keeps reviewed responsive attributes while emitting no style", () => {
    render(<CspPublicImage {...imageProps} />);
    const image = screen.getByRole("img", { name: "A family memory" });

    expect(image).not.toHaveAttribute("style");
    expect(image).toHaveAttribute("srcset");
    expect(image).toHaveAttribute("sizes", "92vw");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "801");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
  });

  it("cannot be reused for private or unreviewed media", () => {
    expect(() =>
      CspPublicImage({
        ...imageProps,
        src: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co/private.jpg",
      }),
    ).toThrow("unreviewed public asset");
  });
});
