// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deliverActivityExpoPush } from "./deliver-activity";

const row = {
  token: "ExponentPushToken[abc]",
  actor_name: "Molly",
  moment_id: "moment-1",
  moment_kind: "photo",
  reaction_type: null,
  snippet: null,
  note_id: null,
};

function client(
  rows: unknown[] = [row],
  error: { message: string } | null = null,
) {
  return {
    rpc: vi.fn(async (fn: string) =>
      fn === "list_expo_push_deliveries"
        ? { data: rows, error }
        : { data: null, error: null },
    ),
  };
}

describe("deliverActivityExpoPush", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends one Expo message per unique token with the web tap destination", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const fetch = vi.fn(async () =>
      Response.json({ data: [{ status: "ok", id: "t1" }] }),
    );
    vi.stubGlobal("fetch", fetch);
    const supabase = client([row, row]);

    await deliverActivityExpoPush(supabase, "moment", "moment-1");

    expect(supabase.rpc).toHaveBeenCalledWith("list_expo_push_deliveries", {
      requested_activity_kind: "moment",
      requested_activity_id: "moment-1",
      requested_note_id: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const body = JSON.parse(String(init.body)) as {
      to: string;
      data: { href: string };
    }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.to).toBe(row.token);
    expect(body[0]?.data.href).toContain("moment-1");
    // Web push is configured, so the web path keeps claiming deliveries.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "claim_mention_push_deliveries",
      expect.anything(),
    );
  });

  it("never throws when the gateway is down, so the action still succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("network down"))),
    );
    await expect(
      deliverActivityExpoPush(client(), "note", "moment-1", { noteId: "n1" }),
    ).resolves.toBeUndefined();
  });

  it("skips quietly when the delivery read fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await deliverActivityExpoPush(
      client([], { message: "missing function" }),
      "reaction",
      "moment-1",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes a token Expo reports as no longer registered", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { status: "error", details: { error: "DeviceNotRegistered" } },
          ],
        }),
      ),
    );
    const supabase = client();
    await deliverActivityExpoPush(supabase, "moment", "moment-1");
    expect(supabase.rpc).toHaveBeenCalledWith("delete_expo_push_token", {
      requested_token: row.token,
    });
  });
});
