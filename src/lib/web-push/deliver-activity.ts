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

export async function deliverActivityWebPush(
  client: ActivityPushClient,
  kind: ActivityPushKind,
  activityId: string,
) {
  if (!webPushIsConfigured()) return;
  try {
    const { data, error } = await client.rpc("list_web_push_deliveries", {
      activity_kind: kind,
      activity_id: activityId,
    });
    if (error || !Array.isArray(data) || data.length === 0) return;

    await Promise.all(
      data.map(async (row) => {
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
            url: activityMomentHref(row.moment_id),
            tag: `our-days:${kind}:${row.moment_id}`,
          },
        );
        if (result.stale) {
          await client.rpc("delete_web_push_subscription", {
            endpoint: row.endpoint,
          });
        }
      }),
    );
  } catch {
    // Delivery must never block saving a family moment, note, or reaction.
  }
}
