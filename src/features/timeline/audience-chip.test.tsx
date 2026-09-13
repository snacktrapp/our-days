import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudienceChip } from "./audience-chip";

describe("AudienceChip", () => {
  it("expands circle names and never offers Edit or Posted to", () => {
    render(
      <AudienceChip
        label="Our Days +1"
        names={["Our Days", "Cousins"]}
        audience="family"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Audience, Our Days +1" }),
    );
    expect(screen.getByText("Our Days")).toBeVisible();
    expect(screen.getByText("Cousins")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Posted to" })).toBeNull();
  });

  it("expands Just me as a name list without an edit path", () => {
    render(<AudienceChip label="Just me" audience="just_me" />);

    fireEvent.click(screen.getByRole("button", { name: "Audience, Just me" }));
    expect(screen.getByRole("listitem")).toHaveTextContent("Just me");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
