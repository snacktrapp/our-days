import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { localJournalIsEnabled } from "../../../../config/our-days-environment";
import {
  parseInsightSourceUrl,
  validInsightAttribution,
  validInsightQuote,
} from "@/features/insights/insight-source";
import {
  readJournalAccessState,
  readJournalCircleMemberships,
} from "@/lib/auth/journal-access";
import { canCreateInsight } from "@/lib/circle-roles";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { readSupabasePublicConfig } from "@/lib/supabase/public-config";
import type { Database } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const plainDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function response(body: object, status: number) {
  return Response.json(body, { status, headers: privateHeaders });
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
}

function sameOrigin(request: Request) {
  return isExpectedMutationOrigin(
    request.headers.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

type InsightWriterMembership = Readonly<{
  circleId: string;
  membershipId: string;
  personId: string;
  role: "organizer" | "operations";
}>;

type InsightWriterAccess = Readonly<{
  primary: InsightWriterMembership;
  memberships: readonly InsightWriterMembership[];
}>;

type InsightTarget = Readonly<{
  audience: "family" | "just_me";
  circleId: string;
  circleIds: readonly string[];
}>;

function pickPrimaryMembership(
  memberships: readonly InsightWriterMembership[],
  preferredCircleId?: string,
) {
  if (preferredCircleId) {
    const preferred = memberships.find(
      (membership) => membership.circleId === preferredCircleId,
    );
    if (preferred) return preferred;
  }
  return memberships[0]!;
}

async function resolveInsightWriterAccess(
  request: Request,
): Promise<
  | { ok: true; access: InsightWriterAccess }
  | { ok: false; status: number; message: string }
> {
  const token = bearerToken(request);
  if (token) {
    const { url, publishableKey } = readSupabasePublicConfig();
    const supabase = createClient<Database>(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (error || typeof userId !== "string") {
      return { ok: false, status: 401, message: "Sign in to continue." };
    }
    const memberships = await supabase
      .from("circle_memberships")
      .select("id, circle_id, person_id, role")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("joined_at", { ascending: true });
    if (memberships.error) {
      return { ok: false, status: 401, message: "Sign in to continue." };
    }
    const writers = (memberships.data ?? [])
      .filter((membership) => canCreateInsight(membership.role))
      .map<InsightWriterMembership>((membership) => ({
        circleId: membership.circle_id,
        membershipId: membership.id,
        personId: membership.person_id,
        role: membership.role === "operations" ? "operations" : "organizer",
      }));
    if (writers.length === 0) {
      return {
        ok: false,
        status: 403,
        message: "Only an organizer or Operations can create an Insight.",
      };
    }
    const writer = pickPrimaryMembership(writers);
    return {
      ok: true,
      access: {
        primary: writer,
        memberships: writers,
      },
    };
  }

  if (!sameOrigin(request)) {
    return {
      ok: false,
      status: 403,
      message: "That request could not be verified.",
    };
  }

  const access = await readJournalAccessState();
  if (access.mode === "anonymous" || access.mode === "no-access") {
    return { ok: false, status: 401, message: "Sign in to continue." };
  }
  if (access.mode !== "authenticated") {
    return {
      ok: false,
      status: 403,
      message: "Preview moments are not saved.",
    };
  }
  if (!canCreateInsight(access.role)) {
    return {
      ok: false,
      status: 403,
      message: "Only an organizer or Operations can create an Insight.",
    };
  }
  const memberships = (await readJournalCircleMemberships())
    .filter((membership) => canCreateInsight(membership.role))
    .map<InsightWriterMembership>((membership) => ({
      circleId: membership.circleId,
      membershipId: membership.membershipId,
      personId: membership.personId,
      role: membership.role === "operations" ? "operations" : "organizer",
    }));
  if (memberships.length === 0) {
    return {
      ok: false,
      status: 403,
      message: "Only an organizer or Operations can create an Insight.",
    };
  }
  return {
    ok: true,
    access: {
      primary: pickPrimaryMembership(memberships, access.circleId),
      memberships,
    },
  };
}

function parseOccurrence(body: Record<string, unknown>) {
  const occurredOn =
    body.occurredOn === undefined || body.occurredOn === null
      ? undefined
      : String(body.occurredOn);
  const occurredAt =
    body.occurredAt === undefined || body.occurredAt === null
      ? null
      : String(body.occurredAt);
  const occurredTimezone =
    body.occurredTimezone === undefined || body.occurredTimezone === null
      ? null
      : String(body.occurredTimezone);
  if (occurredOn !== undefined && !plainDatePattern.test(occurredOn)) {
    return null;
  }
  if ((occurredAt === null) !== (occurredTimezone === null)) return null;
  return { occurredOn, occurredAt, occurredTimezone };
}

function parseInsightTarget(
  body: Record<string, unknown>,
  access: InsightWriterAccess,
):
  | { ok: true; target: InsightTarget }
  | { ok: false; status: number; message: string } {
  const requestedAudience =
    body.audience === undefined || body.audience === null
      ? "family"
      : String(body.audience);
  if (requestedAudience !== "family" && requestedAudience !== "just_me") {
    return {
      ok: false,
      status: 400,
      message: "Check the Insight and try again.",
    };
  }

  const allowedCircleIds = new Set(access.memberships.map((m) => m.circleId));
  const requestedCircleId =
    body.circleId === undefined || body.circleId === null
      ? access.primary.circleId
      : String(body.circleId);
  if (
    !uuidPattern.test(requestedCircleId) ||
    !allowedCircleIds.has(requestedCircleId)
  ) {
    return {
      ok: false,
      status: 403,
      message: "That circle could not be targeted.",
    };
  }

  if (requestedAudience === "just_me") {
    return {
      ok: true,
      target: {
        audience: "just_me",
        circleId: requestedCircleId,
        circleIds: [],
      },
    };
  }

  const requestedCircleIds = body.circleIds;
  if (requestedCircleIds === undefined || requestedCircleIds === null) {
    return {
      ok: true,
      target: {
        audience: "family",
        circleId: requestedCircleId,
        circleIds: [requestedCircleId],
      },
    };
  }
  if (!Array.isArray(requestedCircleIds)) {
    return {
      ok: false,
      status: 400,
      message: "Check the Insight and try again.",
    };
  }
  const normalized: string[] = [];
  for (const candidate of requestedCircleIds) {
    if (typeof candidate !== "string" || !uuidPattern.test(candidate)) {
      return {
        ok: false,
        status: 400,
        message: "Check the Insight and try again.",
      };
    }
    if (!allowedCircleIds.has(candidate)) {
      return {
        ok: false,
        status: 403,
        message: "That circle could not be targeted.",
      };
    }
    if (!normalized.includes(candidate)) normalized.push(candidate);
  }
  if (!normalized.includes(requestedCircleId)) {
    normalized.unshift(requestedCircleId);
  }
  if (normalized.length === 0) normalized.push(requestedCircleId);
  return {
    ok: true,
    target: {
      audience: "family",
      circleId: requestedCircleId,
      circleIds: normalized,
    },
  };
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response({ ok: false, message: "Insight request is invalid." }, 400);
  }
  if (typeof payload !== "object" || payload === null) {
    return response({ ok: false, message: "Insight request is invalid." }, 400);
  }

  const body = payload as Record<string, unknown>;
  if (
    !validInsightQuote(body.quote) ||
    !validInsightAttribution(body.attribution)
  ) {
    return response(
      { ok: false, message: "Check the Insight and try again." },
      400,
    );
  }
  const source = parseInsightSourceUrl(body.sourceUrl);
  if (!source.ok) {
    return response(
      { ok: false, message: "Check the Insight and try again." },
      400,
    );
  }
  const occurrence = parseOccurrence(body);
  if (!occurrence) {
    return response(
      { ok: false, message: "Check the Insight and try again." },
      400,
    );
  }

  const resolved = await resolveInsightWriterAccess(request);
  if (!resolved.ok) {
    return response({ ok: false, message: resolved.message }, resolved.status);
  }
  const target = parseInsightTarget(body, resolved.access);
  if (!target.ok) {
    return response({ ok: false, message: target.message }, target.status);
  }

  if (localJournalIsEnabled()) {
    const { createLocalInsightMoment } =
      await import("@/lib/local-journal/store");
    const targetMembership =
      resolved.access.memberships.find(
        (membership) => membership.circleId === target.target.circleId,
      ) ?? resolved.access.primary;
    try {
      const momentId = await createLocalInsightMoment(
        {
          ...targetMembership,
        },
        {
          quote: body.quote.trim(),
          attribution: body.attribution.trim(),
          sourceUrl: source.url,
          occurredOn:
            occurrence.occurredOn ?? new Date().toISOString().slice(0, 10),
          occurredAt: occurrence.occurredAt,
          occurredTimezone: occurrence.occurredTimezone,
          audience: target.target.audience,
          circleId: target.target.circleId,
          circleIds: target.target.circleIds,
        },
      );
      revalidatePath("/family");
      return response({ ok: true, momentId }, 201);
    } catch {
      return response(
        { ok: false, message: "Insight could not be created." },
        403,
      );
    }
  }

  const token = bearerToken(request);
  const supabase = token
    ? createClient<Database>(
        readSupabasePublicConfig().url,
        readSupabasePublicConfig().publishableKey,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        },
      )
    : await createOurDaysServerClient();

  const { data, error } = await supabase.rpc("create_insight_moment", {
    circle_id: target.target.circleId,
    quote: body.quote.trim(),
    attribution: body.attribution.trim(),
    source_url: source.url,
    occurred_on: occurrence.occurredOn,
    occurred_at: occurrence.occurredAt ?? undefined,
    occurred_timezone: occurrence.occurredTimezone ?? undefined,
    audience: target.target.audience,
    circle_ids:
      target.target.audience === "family"
        ? [...target.target.circleIds]
        : ([] as string[]),
  });
  if (error || typeof data !== "string") {
    const denied = error?.code === "42501";
    return response(
      {
        ok: false,
        message: denied
          ? "Only an organizer or Operations can create an Insight."
          : "Insight could not be created.",
      },
      denied ? 403 : 400,
    );
  }

  revalidatePath("/family");
  return response({ ok: true, momentId: data }, 201);
}
