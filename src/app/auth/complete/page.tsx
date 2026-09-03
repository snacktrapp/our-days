import { CompleteInvitedSession } from "./complete-invited-session";

export default function AuthCompletePage() {
  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="auth-complete-title"
      >
        <span className="private-entry-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="eyebrow">Our Days</span>
        <h1 id="auth-complete-title">Opening your family journal.</h1>
        <div className="private-entry-content">
          <CompleteInvitedSession />
        </div>
      </section>
    </main>
  );
}
