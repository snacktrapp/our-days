import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  LocalMailpitInvitationProvider,
  LocalMailpitProviderError,
} from "../../scripts/lib/mailpit-invitation-provider.mjs";

const jobId = "a4000000-0000-4000-8000-000000000001";
const token = "A".repeat(43);
const input = {
  jobId,
  deliveryVersion: 1,
  idempotencyKey: `our-days/invitation-delivery/v1:${jobId}:1`,
  displayName: "A Relative",
  recipientEmail: "new.relative@example.test",
  invitationToken: token,
} as const;

type SmtpDelivery = Readonly<{
  host: string;
  port: number;
  recipientEmail: string;
  message: string;
}>;

function harness() {
  const send = vi.fn(async (delivery: SmtpDelivery) => {
    void delivery;
  });
  const provider = new LocalMailpitInvitationProvider({
    siteOrigin: "http://127.0.0.1:3000",
    send,
    clock: () => new Date("2026-08-31T20:00:00.000Z"),
  });
  return { provider, send };
}

describe("local Mailpit invitation provider", () => {
  it("submits one exact private fragment link and returns a payload-bound receipt", async () => {
    const { provider, send } = harness();
    const receipt = await provider.deliver(input);
    expect(receipt).toEqual({
      provider: "mailpit-local",
      messageId: expect.stringMatching(/^[0-9a-f]{64}@our-days\.local$/u),
      acceptedAt: "2026-08-31T20:00:00.000Z",
      idempotencyKey: input.idempotencyKey,
      payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(JSON.stringify(receipt)).not.toContain(token);
    expect(JSON.stringify(receipt)).not.toContain(input.recipientEmail);

    const delivery = send.mock.calls[0]?.[0];
    expect(delivery).toMatchObject({
      host: "127.0.0.1",
      port: 54325,
      recipientEmail: input.recipientEmail,
    });
    expect(delivery?.message).toContain(
      `http://127.0.0.1:3000/invite#${token}`,
    );
    expect(delivery?.message).not.toMatch(/invite\?[^\r\n]*token/iu);
    expect(receipt.payloadSha256).toBe(
      createHash("sha256")
        .update(delivery?.message ?? "")
        .digest("hex"),
    );
  });

  it("deduplicates an exact retry within the local harness process", async () => {
    const { provider, send } = harness();
    const first = await provider.deliver(input);
    const second = await provider.deliver({ ...input });
    expect(second).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails a conflicting payload under the same provider idempotency key", async () => {
    const { provider, send } = harness();
    await provider.deliver(input);
    await expect(
      provider.deliver({ ...input, displayName: "Another Relative" }),
    ).rejects.toBeInstanceOf(LocalMailpitProviderError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong job", { jobId: "not-a-uuid" }],
    ["wrong version", { deliveryVersion: 0 }],
    ["wrong key", { idempotencyKey: "wrong" }],
    [
      "header injection",
      { recipientEmail: "new@example.test\r\nBcc:x@y.test" },
    ],
    ["name control", { displayName: "A\u0000Relative" }],
    ["raw token shape", { invitationToken: "too-short" }],
    ["extra field", { actionUrl: "https://attacker.invalid" }],
  ])("rejects %s before SMTP", async (_label, override) => {
    const { provider, send } = harness();
    await expect(
      provider.deliver({ ...input, ...override }),
    ).rejects.toBeInstanceOf(LocalMailpitProviderError);
    expect(send).not.toHaveBeenCalled();
  });

  it("maps SMTP failures to a content-free error", async () => {
    const send = vi.fn(async (delivery: SmtpDelivery) => {
      void delivery;
      throw new Error(`${input.recipientEmail} ${token}`);
    });
    const provider = new LocalMailpitInvitationProvider({
      siteOrigin: "http://127.0.0.1:3000",
      send,
    });
    const error = await provider
      .deliver(input)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LocalMailpitProviderError);
    expect(String(error)).not.toContain(input.recipientEmail);
    expect(String(error)).not.toContain(token);
  });

  it.each([
    "http://example.com",
    "https://example.com/path",
    "https://user:password@example.com",
  ])("rejects unsafe application origin %s", (siteOrigin) => {
    expect(
      () => new LocalMailpitInvitationProvider({ siteOrigin, send: vi.fn() }),
    ).toThrow(LocalMailpitProviderError);
  });
});
