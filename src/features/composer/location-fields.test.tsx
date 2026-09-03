import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationFields } from "./location-fields";
import { emptyPlaceSelection } from "@/lib/place-coordinates";

describe("location fields", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("matches date/time picker chrome and stays calm without a MapTiler key", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LocationFields
        required
        value={emptyPlaceSelection()}
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /^Place, Add a place/u }),
    );
    expect(
      screen.getByRole("dialog", { name: "Choose a place" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Place name")).toBeVisible();
    expect(screen.getByLabelText("Place name")).toHaveAttribute(
      "placeholder",
      "Add a place by hand",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Map unavailable");
    expect(screen.queryByTitle("Place map")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use my location" }),
    ).toBeNull();

    await user.type(screen.getByLabelText("Place name"), "The porch");
    expect(onChange).toHaveBeenLastCalledWith({
      label: "The porch",
      latitude: null,
      longitude: null,
    });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose a place" })).toBeNull();
  });

  it("keeps a typed label and offers MapTiler suggestions when a public key exists", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              place_name: "Sand Harbor, NV",
              center: [-119.93, 39.2],
            },
          ],
        }),
      }),
    );
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LocationFields
        required
        value={emptyPlaceSelection()}
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /^Place, Add a place/u }),
    );
    expect(screen.getByText("Search")).toBeVisible();
    expect(screen.getByTitle("Place map")).toBeVisible();
    expect(screen.queryByText("Map unavailable")).toBeNull();

    await user.type(screen.getByLabelText("Place name"), "Sand");
    expect(onChange).toHaveBeenLastCalledWith({
      label: "Sand",
      latitude: null,
      longitude: null,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sand Harbor, NV" }),
      ).toBeVisible(),
    );

    await user.click(screen.getByRole("button", { name: "Sand Harbor, NV" }));
    expect(onChange).toHaveBeenLastCalledWith({
      label: "Sand Harbor, NV",
      latitude: 39.2,
      longitude: -119.93,
    });
  });
});
