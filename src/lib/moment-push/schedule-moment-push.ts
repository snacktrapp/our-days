import "server-only";

import { deliverActivityExpoPush } from "@/lib/expo-push/deliver-activity";
import {
  deliverActivityWebPush,
  type ActivityPushClient,
} from "@/lib/web-push/deliver-activity";
import { MOMENT_PUSH_FALLBACK_MS, MOMENT_PUSH_POLL_MS } from "./constants";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type DeliveryStatusRow = Readonly<{
  already_notified: boolean;
  media_ready: boolean;
  fallback_elapsed: boolean;
  should_send: boolean;
}>;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isDeliveryStatusRow(value: unknown): value is DeliveryStatusRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.already_notified === "boolean" &&
    typeof row.media_ready === "boolean" &&
    typeof row.fallback_elapsed === "boolean" &&
    typeof row.should_send === "boolean"
  );
}

async function readDeliveryStatus(client: RpcClient, momentId: string) {
  const { data, error } = await client.rpc("moment_push_delivery_status", {
    requested_moment_id: momentId,
  });
  if (error) {
    console.info("[moment-push] status_skipped", {
      momentId,
      message: error.message,
    });
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  return isDeliveryStatusRow(row) ? row : null;
}

async function claimMomentPush(client: RpcClient, momentId: string) {
  const { data, error } = await client.rpc("claim_moment_push_delivery", {
    requested_moment_id: momentId,
  });
  if (error) {
    console.info("[moment-push] claim_skipped", {
      momentId,
      message: error.message,
    });
    return false;
  }
  return data === true;
}

async function deliverMomentAndMentionPushes(client: object, momentId: string) {
  const webClient = client as ActivityPushClient;
  await deliverActivityExpoPush(client, "moment", momentId);
  await deliverActivityWebPush(webClient, "moment", momentId);
  await deliverActivityExpoPush(client, "mention", momentId);
  await deliverActivityWebPush(webClient, "mention", momentId);
}

/**
 * Waits until all media is ready or the fallback window elapses, then sends
 * exactly one new-post moment push (plus mention pushes). Comment, mention,
 * and heart pushes stay on their immediate paths.
 */
export async function scheduleMomentPush(client: object, momentId: string) {
  const rpc = client as RpcClient;
  const deadline = Date.now() + MOMENT_PUSH_FALLBACK_MS + MOMENT_PUSH_POLL_MS;

  while (Date.now() < deadline) {
    const status = await readDeliveryStatus(rpc, momentId);
    if (!status) return;
    if (status.already_notified) return;
    if (status.should_send) {
      const claimed = await claimMomentPush(rpc, momentId);
      if (!claimed) return;
      await deliverMomentAndMentionPushes(client, momentId);
      return;
    }
    await sleep(MOMENT_PUSH_POLL_MS);
  }
}
