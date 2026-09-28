// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
} from "@ai-sdk/gateway";

const generateText = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText };
});

import { FoundBudgetError, FoundUnavailableError } from "./errors.server";
import { proposeFoundLeads } from "./model.server";

describe("Found model errors", () => {
  beforeEach(() => {
    generateText.mockReset();
  });

  it("maps a real gateway 402 to resting", async () => {
    generateText.mockRejectedValue(
      new GatewayInternalServerError({
        message: "Insufficient funds",
        statusCode: 402,
      }),
    );
    await expect(
      proposeFoundLeads("excellence", new AbortController().signal),
    ).rejects.toBeInstanceOf(FoundBudgetError);
  });

  it("maps a gateway authentication failure to unavailable", async () => {
    generateText.mockRejectedValue(
      new GatewayAuthenticationError({
        message: "AI Gateway authentication failed: Invalid OIDC token.",
      }),
    );
    await expect(
      proposeFoundLeads("excellence", new AbortController().signal),
    ).rejects.toBeInstanceOf(FoundUnavailableError);
  });
});
