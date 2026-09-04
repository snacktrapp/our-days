import { describe, expect, it } from "vitest";
import { unexpectedConsoleErrors } from "../e2e/page-health";

describe("pageHealth maps unavailable console filter", () => {
  it("keeps unrelated console errors", () => {
    expect(
      unexpectedConsoleErrors(["console: Hydration failed", "pageerror: boom"]),
    ).toEqual(["console: Hydration failed", "pageerror: boom"]);
  });

  it("allows maps 503 text that already includes the API path", () => {
    expect(
      unexpectedConsoleErrors([
        "console: Failed to load resource: /api/maps/static?lat=1&lng=2 status of 503 (Service Unavailable)",
      ]),
    ).toEqual([]);
  });

  it("allows Chrome's URL-less 503 when a maps endpoint returned 503", () => {
    expect(
      unexpectedConsoleErrors(
        [
          "console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
        ],
        { mapsUnavailableStatuses: [503] },
      ),
    ).toEqual([]);
  });

  it("keeps a leftover URL-less 503 when maps did not return that status", () => {
    expect(
      unexpectedConsoleErrors(
        [
          "console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
        ],
        { mapsUnavailableStatuses: [502] },
      ),
    ).toEqual([
      "console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    ]);
  });

  it("consumes one recorded maps status per URL-less console error", () => {
    expect(
      unexpectedConsoleErrors(
        [
          "console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
          "console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
        ],
        { mapsUnavailableStatuses: [503] },
      ),
    ).toEqual([
      "console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    ]);
  });
});
