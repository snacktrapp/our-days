import { isDesignPreviewEnvironment } from "../../../../../config/design-preview-policy";
import {
  foundSearchIsEnabled,
  localJournalIsEnabled,
} from "../../../../../config/our-days-environment";
import {
  foundCapMessage,
  foundMemberMessage,
  foundUnavailableMessage,
  parseFoundQuery,
} from "@/features/insights/found-types";
import {
  readJournalAccessState,
  readJournalCircleMemberships,
} from "@/lib/auth/journal-access";
import { canCreateInsight } from "@/lib/circle-roles";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import {
  connectedFoundDeps,
  runFoundSearch,
} from "@/lib/found/pipeline.server";
import { runFixtureFoundSearch } from "@/lib/found/fixture.server";
import type { FoundSearchOutcome } from "@/lib/found/pipeline.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function response(body: object, status: number) {
  return Response.json(body, { status, headers: privateHeaders });
}

function sameOrigin(request: Request) {
  return isExpectedMutationOrigin(
    request.headers.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

function foundE2eFixture() {
  return (
    process.env.OUR_DAYS_FOUND_E2E === "fixture" &&
    process.env.OUR_DAYS_ENVIRONMENT === "local" &&
    process.env.VERCEL !== "1" &&
    process.env.OUR_DAYS_RESOURCE_MODE === "detached"
  );
}

function outcomeResponse(outcome: FoundSearchOutcome) {
  if (!outcome.ok) {
    const status = outcome.reason === "resting" ? 402 : 200;
    return response({ ok: false, message: outcome.message }, status);
  }
  return response({ ok: true, candidates: outcome.candidates }, 200);
}

export async function POST(request: Request) {
  if (!foundSearchIsEnabled()) {
    return response({ ok: false, message: "Found is disabled." }, 404);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response(
      { ok: false, message: "Check the search and try again." },
      400,
    );
  }
  if (!sameOrigin(request)) {
    return response(
      { ok: false, message: "That request could not be verified." },
      403,
    );
  }
  const query = parseFoundQuery(
    payload && typeof payload === "object"
      ? (payload as { query?: unknown }).query
      : null,
  );
  if (!query) {
    return response(
      { ok: false, message: "Check the search and try again." },
      400,
    );
  }

  if (isDesignPreviewEnvironment(process.env)) {
    return outcomeResponse(await runFixtureFoundSearch(query));
  }

  const access = await readJournalAccessState();
  if (access.mode === "anonymous" || access.mode === "no-access") {
    return response({ ok: false, message: "Sign in to continue." }, 401);
  }
  if (access.mode !== "authenticated") {
    return response({ ok: false, message: "Found is disabled." }, 403);
  }
  const memberships = await readJournalCircleMemberships();
  const allowed =
    canCreateInsight(access.role) ||
    memberships.some((membership) => canCreateInsight(membership.role));
  if (!allowed) {
    return response({ ok: false, message: foundMemberMessage }, 403);
  }

  if (localJournalIsEnabled() || foundE2eFixture()) {
    return outcomeResponse(await runFixtureFoundSearch(query));
  }

  const supabase = await createOurDaysServerClient();
  const claimed = await supabase.rpc("claim_found_search");
  if (
    claimed.error ||
    (claimed.data !== "claimed" && claimed.data !== "capped")
  ) {
    return response({ ok: false, message: foundUnavailableMessage }, 503);
  }
  if (claimed.data === "capped") {
    return response({ ok: false, message: foundCapMessage }, 429);
  }

  return outcomeResponse(await runFoundSearch(query, connectedFoundDeps()));
}
