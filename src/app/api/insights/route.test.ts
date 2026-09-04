// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createBearerClient: vi.fn(),
  readAccess: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
  createLocalInsight: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/journal-access", () => ({
  readJournalAccessState: mocks.readAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/supabase/public-config", () => ({
  readSupabasePublicConfig: () => ({
    url: "https://example.supabase.co",
    publishableKey: "publishable",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mocks.createBearerClient(...args),
}));
vi.mock("@/lib/local-journal/store", () => ({
  createLocalInsightMoment: mocks.createLocalInsight,
}));

import { POST } from "./route";

const organizerAccess = {
  mode: "authenticated" as const,
  membershipId: "40000000-0000-4000-8000-000000000001",
  circleId: "20000000-0000-4000-8000-000000000001",
  personId: "30000000-0000-4000-8000-000000000001",
  role: "organizer",
};

const insightId = "60000000-0000-4000-8000-000000000008";

function request(
  body: unknown,
  headers: HeadersInit = { origin: "https://journal.example.com" },
) {
  return POST(
    new Request("https://journal.example.com/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("insight create route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    vi.stubEnv("OUR_DAYS_LOCAL_JOURNAL_MODE", "disabled");
    mocks.readAccess.mockResolvedValue(organizerAccess);
    mocks.rpc.mockResolvedValue({ data: insightId, error: null });
    mocks.createServerClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates an Insight for an organizer session on the active circle", async () => {
    const response = await request({
      quote: "  Morning sunlight sets the clock.  ",
      attribution: "  Huberman Lab — Master Your Sleep  ",
      sourceUrl: "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
      occurredOn: "2026-08-28",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      momentId: insightId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_insight_moment", {
      circle_id: organizerAccess.circleId,
      quote: "Morning sunlight sets the clock.",
      attribution: "Huberman Lab — Master Your Sleep",
      source_url: "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
      occurred_on: "2026-08-28",
      occurred_at: undefined,
      occurred_timezone: undefined,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/family");
  });

  it("rejects a member session even with a valid payload", async () => {
    mocks.readAccess.mockResolvedValue({ ...organizerAccess, role: "member" });
    const response = await request({
      quote: "A quote",
      attribution: "A show",
    });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing origin on cookie-authenticated requests", async () => {
    const response = await request(
      { quote: "A quote", attribution: "A show" },
      {},
    );
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a foreign circle id instead of trusting the client", async () => {
    const response = await request({
      quote: "A quote",
      attribution: "A show",
      circleId: "20000000-0000-4000-8000-000000000002",
    });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects javascript and http source URLs", async () => {
    const javascript = await request({
      quote: "A quote",
      attribution: "A show",
      sourceUrl: "javascript:alert(1)",
    });
    const http = await request({
      quote: "A quote",
      attribution: "A show",
      sourceUrl: "http://example.test/x",
    });
    expect(javascript.status).toBe(400);
    expect(http.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts an organizer bearer token without a same-origin header", async () => {
    const membershipQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: organizerAccess.membershipId,
            circle_id: organizerAccess.circleId,
            person_id: organizerAccess.personId,
            role: "organizer",
          },
        ],
        error: null,
      }),
    };
    mocks.createBearerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue(membershipQuery),
      rpc: mocks.rpc,
    });

    const response = await request(
      {
        quote: "Curiosity is a form of courage.",
        attribution: "The Diary of a CEO",
      },
      { authorization: "Bearer organizer-token" },
    );
    expect(response.status).toBe(201);
    expect(mocks.createBearerClient).toHaveBeenCalled();
    expect(mocks.readAccess).not.toHaveBeenCalled();
  });
});
