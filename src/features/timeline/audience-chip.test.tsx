import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudienceChip } from "./audience-chip";

describe("AudienceChip", () => {
  it("renders a decorative chip and does not expand names", () => {
    const { container } = render(
      <AudienceChip label="Our Days +1" audience="family" />,
    );

    const chip = screen.getByLabelText("Audience, Our Days +1");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).toHaveTextContent("Our Days +1");
    expect(
      screen.queryByRole("button", { name: "Audience, Our Days +1" }),
    ).toBeNull();
    fireEvent.click(chip);
    expect(container.querySelector(".audience-chip-detail")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("Cousins")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Posted to" })).toBeNull();
  });

  it("renders Just me as decoration without an edit path", () => {
    render(<AudienceChip label="Just me" audience="just_me" />);

    const chip = screen.getByLabelText("Audience, Just me");
    expect(chip).toHaveTextContent("Just me");
    expect(chip.querySelector(".just-me-pill")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Audience, Just me" }),
    ).toBeNull();
    fireEvent.click(chip);
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
