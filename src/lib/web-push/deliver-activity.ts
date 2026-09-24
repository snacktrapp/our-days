import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  activityMomentHref,
  activityNotificationTitle,
  entryCommentMessage,
  entryReactionMessage,
  familyMomentPostedMessage,
  mentionNotificationMessage,
} from "@/lib/activity-notifications";
import { sendWebPush } from "./send";
import { webPushIsConfigured } from "./keys";

export type ActivityPushKind = "moment" | "note" | "reaction" | "mention";

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
  options?: Readonly<{ noteId?: string | null }>,
) {
  if (!webPushIsConfigured()) {
    logPushSkip("not_configured", { kind, activityId });
    return;
  }
  try {
    const { data, error } =
      kind === "mention"
        ? await client.rpc("claim_mention_push_deliveries", {
            requested_moment_id: activityId,
            requested_note_id: options?.noteId ?? undefined,
          })
        : await client.rpc("list_web_push_deliveries", {
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
        const actorName = row.actor_name?.trim() || "Family";
        const mentionSnippet =
          "snippet" in row && typeof row.snippet === "string"
            ? row.snippet
            : "";
        const title =
          kind === "mention"
            ? activityNotificationTitle(
                actorName,
                mentionNotificationMessage(mentionSnippet),
              )
            : kind === "note"
              ? activityNotificationTitle(actorName, entryCommentMessage)
              : pushTitle(row as DeliveryRow);
        const noteId =
          kind === "mention" &&
          "note_id" in row &&
          typeof row.note_id === "string"
            ? row.note_id
            : options?.noteId;
        const result = await sendWebPush(
          {
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            auth: row.auth,
          },
          {
            title,
            url: activityMomentHref(
              row.moment_id,
              kind === "note" || (kind === "mention" && noteId)
                ? { noteId, thread: true }
                : kind === "reaction"
                  ? { thread: true }
                  : undefined,
            ),
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
