import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { localJournalIsEnabled } from "../../../../config/our-days-environment";
import {
  parseInsightSourceUrl,
  validInsightAttribution,
  validInsightQuote,
} from "@/features/insights/insight-source";
import { readJournalAccessState } from "@/lib/auth/journal-access";
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

type OrganizerAccess = Readonly<{
  circleId: string;
  membershipId: string;
  personId: string;
}>;

async function resolveOrganizerAccess(
  request: Request,
): Promise<
  | { ok: true; access: OrganizerAccess }
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
    const organizers = (memberships.data ?? []).filter(
      (membership) => membership.role === "organizer",
    );
    if (organizers.length === 0) {
      return {
        ok: false,
        status: 403,
        message: "Only an organizer can create an Insight.",
      };
    }
    return {
      ok: true,
      access: {
        circleId: organizers[0]!.circle_id,
        membershipId: organizers[0]!.id,
        personId: organizers[0]!.person_id,
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
  if (access.role !== "organizer") {
    return {
      ok: false,
      status: 403,
      message: "Only an organizer can create an Insight.",
    };
  }
  return {
    ok: true,
    access: {
      circleId: access.circleId,
      membershipId: access.membershipId,
      personId: access.personId,
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

  const resolved = await resolveOrganizerAccess(request);
  if (!resolved.ok) {
    return response({ ok: false, message: resolved.message }, resolved.status);
  }

  const requestedCircleId =
    body.circleId === undefined || body.circleId === null
      ? resolved.access.circleId
      : String(body.circleId);
  if (
    !uuidPattern.test(requestedCircleId) ||
    requestedCircleId !== resolved.access.circleId
  ) {
    return response(
      { ok: false, message: "That family could not be targeted." },
      403,
    );
  }

  if (localJournalIsEnabled()) {
    const { createLocalInsightMoment } =
      await import("@/lib/local-journal/store");
    try {
      const momentId = await createLocalInsightMoment(
        {
          ...resolved.access,
          role: "organizer",
        },
        {
          quote: body.quote.trim(),
          attribution: body.attribution.trim(),
          sourceUrl: source.url,
          occurredOn:
            occurrence.occurredOn ?? new Date().toISOString().slice(0, 10),
          occurredAt: occurrence.occurredAt,
          occurredTimezone: occurrence.occurredTimezone,
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
    circle_id: requestedCircleId,
    quote: body.quote.trim(),
    attribution: body.attribution.trim(),
    source_url: source.url,
    occurred_on: occurrence.occurredOn,
    occurred_at: occurrence.occurredAt ?? undefined,
    occurred_timezone: occurrence.occurredTimezone ?? undefined,
  });
  if (error || typeof data !== "string") {
    const denied = error?.code === "42501";
    return response(
      {
        ok: false,
        message: denied
          ? "Only an organizer can create an Insight."
          : "Insight could not be created.",
      },
      denied ? 403 : 400,
    );
  }

  revalidatePath("/family");
  return response({ ok: true, momentId: data }, 201);
}
