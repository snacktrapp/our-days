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

  it("shows one-step search without an Add a place trigger", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LocationFields
        optional
        value={emptyPlaceSelection()}
        onChange={onChange}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Place, Add a place/u }),
    ).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Choose a place" })).toBeNull();
    expect(screen.getByLabelText("Place name")).toBeVisible();
    expect(screen.getByLabelText("Place name")).toHaveAttribute(
      "placeholder",
      "Search for a place",
    );
    expect(screen.getByText("Search for a place")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Place name"), "The porch");
    expect(onChange).toHaveBeenLastCalledWith({
      label: "The porch",
      latitude: null,
      longitude: null,
    });
  });

  it("keeps a typed label after choosing a searched place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            label: "Sand Harbor",
            detail: "Sand Harbor, NV, United States",
            latitude: 39.2,
            longitude: -119.93,
          },
        ],
      }),
    );
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <LocationFields
        required
        value={emptyPlaceSelection()}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Search for a place")).toBeVisible();
    expect(screen.queryByText("Map unavailable")).toBeNull();

    await user.type(screen.getByLabelText("Place name"), "Sand");
    expect(onChange).toHaveBeenLastCalledWith({
      label: "Sand",
      latitude: null,
      longitude: null,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Sand Harbor/u }),
      ).toBeVisible(),
    );
    expect(screen.getByText("Sand Harbor, NV, United States")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Sand Harbor/u }));
    expect(onChange).toHaveBeenLastCalledWith({
      label: "Sand Harbor",
      latitude: 39.2,
      longitude: -119.93,
    });

    rerender(
      <LocationFields
        required
        value={{
          label: "Sand Harbor",
          latitude: 39.2,
          longitude: -119.93,
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("Place name")).toHaveValue("Sand Harbor");
    expect(screen.queryByTitle("Map of Sand Harbor")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not fold optional place behind a second search popup", () => {
    render(
      <LocationFields
        optional
        value={emptyPlaceSelection()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Place name")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Choose a place" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Place, Add a place/u }),
    ).toBeNull();
  });

  it("shows a visible error when place search is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({}),
      }),
    );
    const user = userEvent.setup();
    render(
      <LocationFields
        required
        value={emptyPlaceSelection()}
        onChange={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Place name"), "San Luis");
    await waitFor(() =>
      expect(
        screen.getByText("Place search isn’t available right now."),
      ).toBeTruthy(),
    );
  });

  it("puts current location on the search field when the browser can geolocate", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: vi.fn() },
    });
    render(
      <LocationFields
        required
        value={emptyPlaceSelection()}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Use my location" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Place name")).toHaveFocus();
  });
});
