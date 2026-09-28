// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
} from "@ai-sdk/gateway";
import { NoOutputGeneratedError } from "ai";

const generateText = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText };
});

import { FoundBudgetError, FoundUnavailableError } from "./errors.server";
import { pickFoundQuote, proposeFoundLeads } from "./model.server";

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

  it("maps a free-tier gateway error to resting", async () => {
    const message =
      "Free tier users do not have access to this model. Upgrade to paid credits";
    generateText.mockRejectedValue(new GatewayInternalServerError({ message }));
    await expect(
      proposeFoundLeads("psalm on rest", new AbortController().signal),
    ).rejects.toBeInstanceOf(FoundBudgetError);
    generateText.mockRejectedValue(new GatewayInternalServerError({ message }));
    await expect(
      pickFoundQuote({
        query: "psalm on rest",
        window: "My soul rests in God alone.",
        signal: new AbortController().signal,
      }),
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

  it("omits model output from the logged error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output =
      "the pursuit of excellence is a long game that rewards the people who stay";
    const error = new Error(`No object generated. ${output}`);
    Object.assign(error, { text: output, responseBody: output });
    generateText.mockRejectedValue(error);
    try {
      await expect(
        proposeFoundLeads("zebra-query-token", new AbortController().signal),
      ).resolves.toEqual([]);
      const logged = warn.mock.calls
        .map((entry) => JSON.stringify(entry[0]))
        .join("\n");
      expect(logged).toContain("No object generated");
      expect(logged).not.toContain(output);
      expect(logged).not.toContain("zebra-query-token");
    } finally {
      warn.mockRestore();
    }
  });

  it("treats a schema miss as zero leads and logs the error name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    generateText.mockRejectedValue(
      new NoOutputGeneratedError({
        message: "No object generated for zebra-query-token.",
      }),
    );
    try {
      await expect(
        proposeFoundLeads("zebra-query-token", new AbortController().signal),
      ).resolves.toEqual([]);
      const call = generateText.mock.calls[0]?.[0] as {
        prepareStep?: (input: { stepNumber: number }) => {
          toolChoice?: string;
          activeTools?: string[];
        };
      };
      expect(call.prepareStep?.({ stepNumber: 0 })).toEqual({});
      expect(call.prepareStep?.({ stepNumber: 3 })).toEqual({
        activeTools: [],
        toolChoice: "none",
      });
      const logged = warn.mock.calls
        .map((entry) => JSON.stringify(entry[0]))
        .join("\n");
      expect(logged).toContain("AI_NoOutputGeneratedError");
      expect(logged).not.toContain("zebra-query-token");
    } finally {
      warn.mockRestore();
    }
  });

  it("asks the picker for a verbatim quote with room for a long passage", async () => {
    generateText.mockResolvedValue({
      output: {
        quote:
          "the pursuit of excellence is a long game that rewards the people who stay",
        hintSeconds: 6762,
      },
    });
    const pick = await pickFoundQuote({
      query: "excellence",
      window:
        "the pursuit of excellence is a long game that rewards the people who stay",
      signal: new AbortController().signal,
    });
    expect(pick).toEqual({
      quote:
        "the pursuit of excellence is a long game that rewards the people who stay",
      hintSeconds: 6762,
    });
    const call = generateText.mock.calls[0]?.[0] as {
      maxOutputTokens?: number;
      system?: string;
    };
    expect(call.maxOutputTokens).toBe(1200);
    expect(call.system).not.toContain("UTF-16");
    expect(call.system).toContain("verbatim");
  });
});
