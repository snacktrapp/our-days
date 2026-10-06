"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zeroTolerance } from "./terms";

export function TermsAcceptanceForm() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div
      className="safety-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
    >
      <form
        className="safety-gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!agreed || pending) return;
          setError(null);
          startTransition(async () => {
            const { acceptCurrentTerms } = await import("./safety-actions");
            const result = await acceptCurrentTerms();
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        <h2 id="terms-gate-title">Terms of Use</h2>
        <p>{zeroTolerance}</p>
        <label className="safety-gate-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noreferrer">
              Terms of Use
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
          </span>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={!agreed || pending}>
          {pending ? "Saving…" : "Agree"}
        </button>
      </form>
    </div>
  );
}
