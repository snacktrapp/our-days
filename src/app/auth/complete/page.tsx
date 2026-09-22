import { CompleteInvitedSession } from "./complete-invited-session";
import { OurDaysWordmark } from "@/components/our-days-wordmark";

export default function AuthCompletePage() {
  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="auth-complete-title"
      >
        <OurDaysWordmark className="private-entry-wordmark" />
        <h1 id="auth-complete-title">Opening your journal.</h1>
        <div className="private-entry-content">
          <CompleteInvitedSession />
        </div>
      </section>
    </main>
  );
}
