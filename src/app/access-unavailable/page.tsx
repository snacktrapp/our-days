import { redirect } from "next/navigation";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { readJournalAccessState } from "@/lib/auth/journal-access";

export default async function AccessUnavailablePage() {
  const access = await readJournalAccessState();
  if (access.mode === "anonymous") redirect("/sign-in");
  if (access.mode === "preview") redirect("/family");

  const isActiveMember = access.mode === "authenticated";
  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="access-unavailable-title"
      >
        <span className="private-entry-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>Private family journal</p>
        <h1 id="access-unavailable-title">
          {isActiveMember
            ? "Your journal is still being prepared."
            : "This account does not have family access."}
        </h1>
        <div className="private-entry-content">
          <p>
            {isActiveMember
              ? "Your membership is active. The connected family timeline is not available in this checkpoint yet."
              : "Ask a family organizer for a current invitation if you should have access."}
          </p>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
