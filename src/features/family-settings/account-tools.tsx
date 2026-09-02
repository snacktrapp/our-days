import Link from "next/link";
import { SignOutButton } from "@/features/auth/sign-out-button";

export function AccountTools() {
  return (
    <section
      className="settings-section account-tools"
      aria-labelledby="account-tools-heading"
    >
      <div className="settings-heading">
        <span>Account</span>
        <h2 id="account-tools-heading">Journal tools</h2>
        <p>Manage removed entries and this signed-in session.</p>
      </div>
      <Link className="account-tool-link" href="/trash" prefetch={false}>
        <span>
          <strong>Recently removed</strong>
          <small>Review and restore entries</small>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
      <div className="account-sign-out">
        <SignOutButton />
      </div>
    </section>
  );
}
