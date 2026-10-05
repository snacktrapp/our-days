import "server-only";

import {
  activityMomentHref,
  activityNotificationTitle,
  familyMomentPostedMessage,
  mentionNotificationMessage,
} from "@/lib/activity-notifications";
import {
  expoNotificationHref,
  expoNotificationTitle,
  type ExpoDeliveryRow,
} from "@/lib/expo-push/message";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { webPushIsConfigured } from "@/lib/web-push/keys";
import { sendWebPush } from "@/lib/web-push/send";
import {
  MOMENT_PUSH_SWEEP_BATCH_LIMIT,
  MOMENT_PUSH_SWEEP_NOT_BEFORE_ISO,
} from "./constants";

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type SweptChannel = "web" | "expo" | "claimed";
type SweptKind = "moment" | "mention";

type SweptPushRow = Readonly<{
  moment_id: string;
  channel: SweptChannel;
  kind: SweptKind;
  destination: string | null;
  p256dh: string | null;
  auth: string | null;
  actor_name: string | null;
  moment_kind: string | null;
  visible_circle_id: string | null;
  circle_name: string | null;
  snippet: string | null;
  note_id: string | null;
}>;

export type MomentPushSweepResult = Readonly<{
  claimed: number;
  deliveries: number;
}>;

function isSweptPushRow(value: unknown): value is SweptPushRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const channel = row.channel;
  const kind = row.kind;
  return (
    typeof row.moment_id === "string" &&
    (channel === "web" || channel === "expo" || channel === "claimed") &&
    (kind === "moment" || kind === "mention") &&
    (row.destination === null || typeof row.destination === "string") &&
    (row.p256dh === null || typeof row.p256dh === "string") &&
    (row.auth === null || typeof row.auth === "string") &&
    (row.actor_name === null || typeof row.actor_name === "string") &&
    (row.moment_kind === null || typeof row.moment_kind === "string") &&
    (row.snippet === null || typeof row.snippet === "string") &&
    (row.note_id === null || typeof row.note_id === "string")
  );
}

function deliveryKey(row: SweptPushRow) {
  return `${row.channel}:${row.kind}:${row.moment_id}:${row.destination ?? ""}`;
}

function webPayload(row: SweptPushRow) {
  const actorName = row.actor_name?.trim() || "Family";
  const opensComment = row.kind === "mention" && Boolean(row.note_id);
  const title =
    row.kind === "mention"
      ? activityNotificationTitle(
          actorName,
          mentionNotificationMessage(row.snippet ?? ""),
        )
      : activityNotificationTitle(
          actorName,
          familyMomentPostedMessage(row.moment_kind ?? ""),
        );
  return {
    title,
    url: activityMomentHref(
      row.moment_id,
      opensComment ? { noteId: row.note_id, thread: true } : undefined,
    ),
    tag: `our-days:${row.kind}:${row.moment_id}`,
  };
}

function expoMessage(row: SweptPushRow & { destination: string }) {
  const delivery: ExpoDeliveryRow = {
    token: row.destination,
    actor_name: row.actor_name,
    moment_id: row.moment_id,
    moment_kind: row.moment_kind,
    reaction_type: null,
    snippet: row.snippet,
    note_id: row.note_id,
  };
  return {
    to: row.destination,
    title: expoNotificationTitle(row.kind, delivery),
    data: { href: expoNotificationHref(row.kind, delivery) },
  };
}

async function sendExpoMessages(
  messages: readonly { to: string; title: string; data: { href: string } }[],
) {
  if (messages.length === 0) return;
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
    console.warn("[moment-push] expo_sweep", { status: response.status });
  }
}

async function deliverSweptRows(rows: readonly SweptPushRow[]) {
  const unique = [
    ...new Map(rows.map((row) => [deliveryKey(row), row])).values(),
  ];
  const webConfigured = webPushIsConfigured();
  const expoMessages: {
    to: string;
    title: string;
    data: { href: string };
  }[] = [];
  const webRows: SweptPushRow[] = [];

  for (const row of unique) {
    if (row.channel === "claimed" || !row.destination) continue;
    if (row.channel === "expo") {
      expoMessages.push(expoMessage({ ...row, destination: row.destination }));
      continue;
    }
    if (!webConfigured || !row.p256dh || !row.auth) continue;
    webRows.push(row);
  }

  const webResults = await Promise.all(
    webRows.map(async (row) => {
      try {
        const result = await sendWebPush(
          {
            endpoint: row.destination!,
            p256dh: row.p256dh!,
            auth: row.auth!,
          },
          webPayload(row),
        );
        console.info("[moment-push] sweep_web", {
          momentId: row.moment_id,
          kind: row.kind,
          ok: result.ok,
          status: result.status,
        });
        return true;
      } catch (error) {
        console.error("[moment-push] sweep_web_failed", {
          momentId: row.moment_id,
          kind: row.kind,
          message: error instanceof Error ? error.message : "unknown",
        });
        return false;
      }
    }),
  );

  let deliveries = webResults.filter(Boolean).length;
  if (expoMessages.length > 0) {
    try {
      await sendExpoMessages(expoMessages);
      deliveries += expoMessages.length;
    } catch (error) {
      console.error("[moment-push] sweep_expo_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return deliveries;
}

/**
 * Claims due moment pushes through the same idempotent RPC the poller uses,
 * then sends the rows that claim won. A second call finds nothing left to
 * claim, so the poller and the cron cannot both deliver one post.
 */
export async function runMomentPushSweep(client?: object) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("Moment push sweep is unavailable.");
  }
  const rpc = (client ?? (await createOurDaysServerClient())) as RpcClient;
  const { data, error } = await rpc.rpc("sweep_due_moment_pushes", {
    presented_secret: secret,
    requested_not_before: MOMENT_PUSH_SWEEP_NOT_BEFORE_ISO,
    requested_limit: MOMENT_PUSH_SWEEP_BATCH_LIMIT,
  });
  if (error) {
    console.warn("[moment-push] sweep_failed", { message: error.message });
    throw new Error("Moment push sweep is unavailable.");
  }
  const rows = Array.isArray(data) ? data.filter(isSweptPushRow) : [];
  const claimed = new Set(
    rows.filter((row) => row.channel === "claimed").map((row) => row.moment_id),
  ).size;
  const deliveries = await deliverSweptRows(rows);
  console.info("[moment-push] sweep_complete", { claimed, deliveries });
  return { claimed, deliveries } satisfies MomentPushSweepResult;
}
