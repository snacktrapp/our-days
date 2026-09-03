import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LocationFields } from "./location-fields";
import { emptyPlaceSelection } from "@/lib/place-coordinates";

describe("location fields", () => {
  it("matches date/time picker chrome and stays calm without a MapTiler key", async () => {
    const user = userEvent.setup();
    render(
      <LocationFields
        required
        value={emptyPlaceSelection()}
        onChange={() => undefined}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /^Place, Add a place/u }),
    );
    expect(
      screen.getByRole("dialog", { name: "Choose a place" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Place name")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Map unavailable");
    expect(screen.queryByTitle("Place map")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use my location" }),
    ).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose a place" })).toBeNull();
  });
});
