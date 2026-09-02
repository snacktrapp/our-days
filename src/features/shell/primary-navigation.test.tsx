import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrimaryNavigation } from "./primary-navigation";

describe("PrimaryNavigation", () => {
  it("contains destinations only", () => {
    render(<PrimaryNavigation section="timeline" />);

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(navigation).toHaveTextContent("Family");
    expect(navigation).toHaveTextContent("People");
    expect(navigation).toHaveTextContent("Memories");
    expect(navigation).not.toHaveTextContent("Add");
    expect(screen.queryByRole("button", { name: "Add moment" })).toBeNull();
  });
});
