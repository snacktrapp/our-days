import Link from "next/link";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { NotificationPreference } from "./notification-preference";

export function AccountTools() {
  return (
    <section
      className="settings-section account-tools"
      aria-labelledby="account-tools-heading"
    >
      <h2 id="account-tools-heading" className="sr-only">
        Journal tools
      </h2>
      <NotificationPreference />
      <Link className="account-tool-link" href="/trash" prefetch={false}>
        <span>
          <strong>Recently removed</strong>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
      <div className="account-sign-out">
        <SignOutButton />
      </div>
    </section>
  );
}
