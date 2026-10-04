import "server-only";

import { webPushIsConfigured } from "@/lib/web-push/keys";
import {
  expoNotificationHref,
  expoNotificationTitle,
  type ExpoDeliveryKind,
  type ExpoDeliveryRow,
} from "./message";

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send";

type RpcResult = Readonly<{
  data: unknown;
  error: { message: string } | null;
}>;

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;
};

function asRpc(client: object): RpcClient {
  return client as RpcClient;
}

function isDeliveryRow(value: unknown): value is ExpoDeliveryRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.token === "string" && typeof row.moment_id === "string";
}

async function claimWithoutWebPush(
  client: RpcClient,
  kind: ExpoDeliveryKind,
  activityId: string,
  noteId?: string | null,
) {
  if (webPushIsConfigured()) return;
  if (kind === "mention") {
    await client.rpc("claim_mention_push_deliveries", {
      requested_moment_id: activityId,
      requested_note_id: noteId ?? null,
    });
    return;
  }
  if (kind === "note_reaction") {
    await client.rpc("claim_note_reaction_push_deliveries", {
      requested_note_id: activityId,
    });
  }
}

async function sendExpoMessages(
  client: RpcClient,
  messages: readonly { to: string; title: string; data: { href: string } }[],
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(expoPushEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(
      messages.map((message) => ({
        to: message.to,
        title: message.title,
        sound: "default",
        data: message.data,
      })),
    ),
  });
  if (!response.ok) {
    console.warn("[expo-push] gateway", { status: response.status });
    return;
  }
  const body = (await response.json()) as {
    data?: { status?: string; details?: { error?: string } }[];
  };
  const tickets = Array.isArray(body.data) ? body.data : [];
  await Promise.all(
    tickets.map(async (ticket, index) => {
      if (ticket.details?.error !== "DeviceNotRegistered") return;
      const token = messages[index]?.to;
      if (!token) return;
      const { error } = await client.rpc("delete_expo_push_token", {
        requested_token: token,
      });
      console.info("[expo-push] stale_token_deleted", {
        deleted: !error,
      });
    }),
  );
}

/**
 * Sends the same activity the web push path just handled, to Expo tokens.
 * Failures stay here so a missing migration or gateway cannot block web push.
 * Call this before deliverActivityWebPush for mentions and comment hearts,
 * so the read still sees rows the web claim has not marked yet.
 */
export async function deliverActivityExpoPush(
  client: object,
  kind: ExpoDeliveryKind,
  activityId: string,
  options?: Readonly<{ noteId?: string | null }>,
) {
  const rpc = asRpc(client);
  try {
    const { data, error } = await rpc.rpc("list_expo_push_deliveries", {
      requested_activity_kind: kind,
      requested_activity_id: activityId,
      requested_note_id: options?.noteId ?? null,
    });
    if (error) {
      console.info("[expo-push] skipped", {
        reason: "rpc_error",
        kind,
        activityId,
        message: error.message,
      });
      return;
    }
    const rows = Array.isArray(data) ? data.filter(isDeliveryRow) : [];
    if (rows.length === 0) {
      await claimWithoutWebPush(rpc, kind, activityId, options?.noteId);
      return;
    }
    const unique = [...new Map(rows.map((row) => [row.token, row])).values()];
    await sendExpoMessages(
      rpc,
      unique.map((row) => ({
        to: row.token,
        title: expoNotificationTitle(kind, row),
        data: { href: expoNotificationHref(kind, row) },
      })),
    );
    await claimWithoutWebPush(rpc, kind, activityId, options?.noteId);
  } catch (error) {
    console.error("[expo-push] failed", {
      kind,
      activityId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
