// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foundFixtureQuote,
  foundFixtureRejectedQuote,
} from "@/features/insights/found-fixture";
import {
  foundCapMessage,
  foundMemberMessage,
  foundRestingMessage,
  foundUnavailableMessage,
} from "@/features/insights/found-types";

const mocks = vi.hoisted(() => ({
  readAccess: vi.fn(),
  readMemberships: vi.fn(),
  rpc: vi.fn(),
  leads: vi.fn(),
  span: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/journal-access", () => ({
  readJournalAccessState: mocks.readAccess,
  readJournalCircleMemberships: mocks.readMemberships,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/found/model.server", () => ({
  foundModelId: "google/gemini-3.5-flash-lite",
  proposeFoundLeads: mocks.leads,
  pickFoundSpan: mocks.span,
}));

import { FoundBudgetError } from "@/lib/found/errors.server";
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
    mocks.readMemberships.mockReset();
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
    mocks.readMemberships.mockResolvedValue([
      { membershipId: "m1", circleId: "c1", personId: "p1", role: "organizer" },
    ]);
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

  it("returns 403 for a member and does not search", async () => {
    mocks.readAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "m2",
      circleId: "c1",
      personId: "p2",
      role: "member",
    });
    mocks.readMemberships.mockResolvedValue([
      { membershipId: "m2", circleId: "c1", personId: "p2", role: "member" },
    ]);
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
