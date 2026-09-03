import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260903120000_enable_organizer_invitation_delivery.sql",
  ),
  "utf8",
);

describe("organizer invitation delivery", () => {
  it("reuses the existing email-request RPC and magic-link vendor", () => {
    expect(migration).toContain("email_delivery");
    expect(migration).toContain("set enabled = true");
    expect(migration).toContain("private.request_invitation_email(");
    expect(migration).toContain("private.ensure_login_capable_auth_user(");
    expect(migration).toContain(
      "public.accept_pending_invitation_for_current_user()",
    );
    expect(migration).toContain(
      "grant execute on function public.accept_pending_invitation_for_current_user()",
    );
    expect(migration).not.toMatch(/resend|sendgrid|postmark|mailgun|ses/iu);
    expect(migration).not.toMatch(/service_role|sb_secret_/u);
  });
});
