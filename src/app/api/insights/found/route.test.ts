// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foundFixtureQuote,
  foundFixtureRejectedQuote,
} from "@/features/insights/found-fixture";
import {
  foundCapMessage,
  foundEmptyMessage,
  foundMemberMessage,
  foundRestingMessage,
  foundUnavailableMessage,
} from "@/features/insights/found-types";

const mocks = vi.hoisted(() => ({
  readAccess: vi.fn(),
  rpc: vi.fn(),
  leads: vi.fn(),
  span: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/journal-access", () => ({
  readJournalAccessState: mocks.readAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/found/model.server", () => ({
  foundModelId: "google/gemini-3.5-flash-lite",
  proposeFoundLeads: mocks.leads,
  pickFoundQuote: mocks.span,
}));

import {
  FoundBudgetError,
  FoundUnavailableError,
} from "@/lib/found/errors.server";
import { POST } from "./route";

const site = "http://127.0.0.1:3102";

function post(query: string, origin = site) {
  return POST(
    new Request(`${site}/api/insights/found`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    }),
  );
}

describe("POST /api/insights/found", () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env = { ...previous };
    process.env.OUR_DAYS_FOUND_MODE = "enabled";
    process.env.NEXT_PUBLIC_SITE_URL = site;
    process.env.OUR_DAYS_ENVIRONMENT = "local";
    process.env.OUR_DAYS_RESOURCE_MODE = "supabase";
    process.env.OUR_DAYS_ENABLE_DESIGN_PREVIEW = "false";
    delete process.env.OUR_DAYS_LOCAL_JOURNAL_MODE;
    delete process.env.OUR_DAYS_FOUND_E2E;
    delete process.env.VERCEL;
    mocks.readAccess.mockReset();
    mocks.rpc.mockReset();
    mocks.leads.mockReset();
    mocks.span.mockReset();
    mocks.leads.mockRejectedValue(new Error("model should not run"));
    mocks.readAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "m1",
      circleId: "c1",
      personId: "p1",
      role: "organizer",
    });
    mocks.rpc.mockResolvedValue({ data: "claimed", error: null });
  });

  afterEach(() => {
    process.env = previous;
  });

  it("stays disabled until OUR_DAYS_FOUND_MODE is enabled", async () => {
    delete process.env.OUR_DAYS_FOUND_MODE;
    const response = await post("excellence");
    expect(response.status).toBe(404);
    expect(mocks.readAccess).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: "Found is disabled.",
    });
  });

  it("returns 403 for the active circle and does not spend a search", async () => {
    mocks.readAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "m2",
      circleId: "c1",
      personId: "p2",
      role: "member",
    });
    const response = await post("excellence");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: foundMemberMessage,
    });
    expect(mocks.leads).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("shows the daily cap before calling the model", async () => {
    mocks.rpc.mockResolvedValue({ data: "capped", error: null });
    const response = await post("excellence");
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: foundCapMessage,
    });
    expect(mocks.leads).not.toHaveBeenCalled();
  });

  it("shows resting when the gateway returns 402 and includes no cards", async () => {
    mocks.leads.mockRejectedValue(new FoundBudgetError());
    const response = await post("excellence");
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toEqual({ ok: false, message: foundRestingMessage });
    expect(body.candidates).toBeUndefined();
  });

  it("says Found is unavailable when the gateway cannot authenticate", async () => {
    mocks.leads.mockRejectedValue(new FoundUnavailableError());
    const response = await post("excellence");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ ok: false, message: foundUnavailableMessage });
    expect(body.candidates).toBeUndefined();
  });

  it("refunds a resting search when the claim has an id", async () => {
    const claimId = "10000000-0000-4000-8000-000000000099";
    mocks.leads.mockRejectedValue(new FoundBudgetError());
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_found_search") return { data: claimId, error: null };
      return { data: "refunded", error: null };
    });
    const response = await post("excellence");
    expect(response.status).toBe(402);
    expect(mocks.rpc).toHaveBeenCalledWith("refund_found_search", {
      claim_id: claimId,
    });
  });

  it("refunds an unavailable search", async () => {
    const claimId = "10000000-0000-4000-8000-000000000098";
    mocks.leads.mockRejectedValue(new FoundUnavailableError());
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_found_search") return { data: claimId, error: null };
      return { data: "refunded", error: null };
    });
    const response = await post("excellence");
    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledWith("refund_found_search", {
      claim_id: claimId,
    });
  });

  it("keeps the resting response when the refund function is not installed yet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const claimId = "10000000-0000-4000-8000-000000000099";
    mocks.leads.mockRejectedValue(new FoundBudgetError());
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_found_search") return { data: claimId, error: null };
      return {
        data: null,
        error: {
          message: "Could not find the function public.refund_found_search",
        },
      };
    });
    try {
      const response = await post("excellence");
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        message: foundRestingMessage,
      });
      expect(warn.mock.calls.flat().join("\n")).toContain(
        '"event":"found.refund"',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("refunds an empty result and leaves a verified card counted", async () => {
    const claimId = "10000000-0000-4000-8000-000000000099";
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_found_search") return { data: claimId, error: null };
      return { data: "refunded", error: null };
    });
    mocks.leads.mockResolvedValue([]);
    const empty = await post("excellence");
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({
      ok: false,
      message: foundEmptyMessage,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("refund_found_search", {
      claim_id: claimId,
    });

    mocks.rpc.mockClear();
    mocks.leads.mockResolvedValue([
      { kind: "bible", book: "Psalm", chapter: 23, startVerse: 1, endVerse: 1 },
    ]);
    const kept = await post("psalm");
    expect(kept.status).toBe(200);
    const body = await kept.json();
    expect(body.ok).toBe(true);
    expect(body.candidates[0].quote.length).toBeGreaterThan(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_found_search");
  });

  it("says Found is unavailable when the claim cannot be recorded", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "missing" } });
    const response = await post("excellence");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      message: foundUnavailableMessage,
    });
    expect(mocks.leads).not.toHaveBeenCalled();
  });

  it("verifies the local-journal fixture on the server", async () => {
    process.env.OUR_DAYS_RESOURCE_MODE = "detached";
    process.env.OUR_DAYS_LOCAL_JOURNAL_MODE = "enabled";
    process.env.OUR_DAYS_FOUND_E2E = "fixture";
    const response = await post("DHH on the pursuit of excellence on Lex");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.candidates[0].quote).toBe(foundFixtureQuote);
    expect(JSON.stringify(body)).not.toContain(foundFixtureRejectedQuote);
    expect(mocks.leads).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
