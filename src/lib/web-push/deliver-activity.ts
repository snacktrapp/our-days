import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  activityMomentHref,
  activityNotificationTitle,
  entryCommentMessage,
  entryReactionMessage,
  familyMomentPostedMessage,
} from "@/lib/activity-notifications";
import { sendWebPush } from "./send";
import { webPushIsConfigured } from "./keys";

export type ActivityPushKind = "moment" | "note" | "reaction";

type DeliveryRow =
  Database["public"]["Functions"]["list_web_push_deliveries"]["Returns"][number];

export type ActivityPushClient = Pick<SupabaseClient<Database>, "rpc">;

function pushTitle(row: DeliveryRow) {
  const actorName = row.actor_name?.trim() || "Family";
  if (row.reaction_type) {
    return activityNotificationTitle(
      actorName,
      entryReactionMessage(row.reaction_type),
    );
  }
  if (!row.moment_kind) {
    return activityNotificationTitle(actorName, entryCommentMessage);
  }
  return activityNotificationTitle(
    actorName,
    familyMomentPostedMessage(row.moment_kind),
  );
}

function logPushSkip(
  reason: "not_configured" | "rpc_error" | "empty_recipients",
  details: Readonly<Record<string, unknown>>,
) {
  const log = reason === "rpc_error" ? console.warn : console.info;
  log("[web-push] skipped", { reason, ...details });
}

export async function deliverActivityWebPush(
  client: ActivityPushClient,
  kind: ActivityPushKind,
  activityId: string,
) {
  if (!webPushIsConfigured()) {
    logPushSkip("not_configured", { kind, activityId });
    return;
  }
  try {
    const { data, error } = await client.rpc("list_web_push_deliveries", {
      activity_kind: kind,
      activity_id: activityId,
    });
    if (error) {
      logPushSkip("rpc_error", {
        kind,
        activityId,
        message: error.message,
      });
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      logPushSkip("empty_recipients", { kind, activityId });
      return;
    }

    const deliveries = [
      ...new Map(data.map((row) => [row.endpoint, row])).values(),
    ];
    console.info("[web-push] recipients", {
      kind,
      activityId,
      count: deliveries.length,
    });

    await Promise.all(
      deliveries.map(async (row) => {
        const title =
          kind === "note"
            ? activityNotificationTitle(
                row.actor_name?.trim() || "Family",
                entryCommentMessage,
              )
            : pushTitle(row);
        const result = await sendWebPush(
          {
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            auth: row.auth,
          },
          {
            title,
            url: activityMomentHref(row.moment_id, row.visible_circle_id),
            tag: `our-days:${kind}:${row.moment_id}`,
          },
        );
        console.info("[web-push] send", {
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
          console.info("[web-push] stale_endpoint_deleted", {
            kind,
            activityId,
            momentId: row.moment_id,
            deleted: !deleteError,
          });
        }
      }),
    );
  } catch (error) {
    console.error("[web-push] failed", {
      kind,
      activityId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
