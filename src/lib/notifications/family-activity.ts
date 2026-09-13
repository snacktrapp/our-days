import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  activityMomentHref,
  entryCommentMessage,
  entryReactionMessage,
  familyActivityPushTitle,
  familyMomentPostedMessage,
} from "@/lib/activity-notifications";
import { sendWebPush } from "@/lib/web-push/send";
import { webPushIsConfigured } from "@/lib/web-push/keys";

export type FamilyActivityKind = "moment" | "note" | "reaction";

export type FamilyActivityClient = Pick<SupabaseClient<Database>, "rpc">;

export type FamilyActivityNotifyResult =
  | Readonly<{ status: "delivered"; count: number }>
  | Readonly<{ status: "empty" }>
  | Readonly<{
      status: "skipped";
      reason: "not_configured" | "already_notified";
    }>
  | Readonly<{ status: "error"; message: string }>;

type DeliveryRow =
  Database["public"]["Functions"]["list_web_push_deliveries"]["Returns"][number];

const terminalResults = new Map<string, FamilyActivityNotifyResult>();
const inflight = new Map<string, Promise<FamilyActivityNotifyResult>>();

function activityKey(kind: FamilyActivityKind, activityId: string) {
  return `${kind}:${activityId}`;
}

function pushTitle(kind: FamilyActivityKind, row: DeliveryRow) {
  const actorName = row.actor_name?.trim() || "Family";
  const circleName = row.circle_name;
  if (kind === "note") {
    return familyActivityPushTitle(actorName, entryCommentMessage, circleName);
  }
  if (row.reaction_type) {
    return familyActivityPushTitle(
      actorName,
      entryReactionMessage(row.reaction_type),
      circleName,
    );
  }
  if (!row.moment_kind) {
    return familyActivityPushTitle(actorName, entryCommentMessage, circleName);
  }
  return familyActivityPushTitle(
    actorName,
    familyMomentPostedMessage(row.moment_kind),
    circleName,
  );
}

function logResult(
  result: FamilyActivityNotifyResult,
  kind: FamilyActivityKind,
  activityId: string,
) {
  if (result.status === "delivered") {
    console.info("[notifications] delivered", {
      kind,
      activityId,
      count: result.count,
    });
    return;
  }
  if (result.status === "empty") {
    const log = kind === "moment" ? console.warn : console.info;
    log("[notifications] empty", {
      kind,
      activityId,
      note:
        kind === "moment"
          ? "unexpected unless every other member is the actor or nobody subscribed"
          : undefined,
    });
    return;
  }
  if (result.status === "skipped") {
    console.info("[notifications] skipped", {
      reason: result.reason,
      kind,
      activityId,
    });
    return;
  }
  console.error("[notifications] error", {
    kind,
    activityId,
    message: result.message,
  });
}

async function deliverFamilyActivity(
  client: FamilyActivityClient,
  kind: FamilyActivityKind,
  activityId: string,
): Promise<FamilyActivityNotifyResult> {
  if (!webPushIsConfigured()) {
    return { status: "skipped", reason: "not_configured" };
  }
  try {
    const { data, error } = await client.rpc("list_web_push_deliveries", {
      activity_kind: kind,
      activity_id: activityId,
    });
    if (error) {
      return { status: "error", message: error.message };
    }
    if (!Array.isArray(data) || data.length === 0) {
      return { status: "empty" };
    }

    const deliveries = [
      ...new Map(data.map((row) => [row.endpoint, row])).values(),
    ];
    console.info("[notifications] recipients", {
      kind,
      activityId,
      count: deliveries.length,
    });

    await Promise.all(
      deliveries.map(async (row) => {
        const result = await sendWebPush(
          {
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            auth: row.auth,
          },
          {
            title: pushTitle(kind, row),
            url: activityMomentHref(row.moment_id, row.visible_circle_id),
            tag: `our-days:${kind}:${row.moment_id}`,
          },
        );
        console.info("[notifications] send", {
          kind,
          activityId,
          momentId: row.moment_id,
          ok: result.ok,
          status: result.status,
          stale: result.stale,
        });
        if (result.stale) {
          const { error: deleteError } = await client.rpc(
            "delete_web_push_subscription",
            {
              endpoint: row.endpoint,
            },
          );
          console.info("[notifications] stale_endpoint_deleted", {
            kind,
            activityId,
            momentId: row.moment_id,
            deleted: !deleteError,
          });
        }
      }),
    );
    return { status: "delivered", count: deliveries.length };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown",
    };
  }
}

export function resetFamilyActivityNotificationsForTests() {
  terminalResults.clear();
  inflight.clear();
}

export async function notifyFamilyActivity(
  client: FamilyActivityClient,
  kind: FamilyActivityKind,
  activityId: string,
): Promise<FamilyActivityNotifyResult> {
  const key = activityKey(kind, activityId);
  const previous = terminalResults.get(key);
  if (
    previous &&
    (previous.status === "delivered" ||
      previous.status === "empty" ||
      previous.status === "skipped")
  ) {
    const result = {
      status: "skipped",
      reason: "already_notified",
    } as const;
    logResult(result, kind, activityId);
    return result;
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const work = (async () => {
    const result = await deliverFamilyActivity(client, kind, activityId);
    logResult(result, kind, activityId);
    if (result.status !== "error") {
      terminalResults.set(key, result);
    }
    return result;
  })();
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}
