import Link from "next/link";
import { OurDaysWordmark } from "@/components/our-days-wordmark";
import { LEGAL_DRAFT_BANNER } from "./draft-banner";
import { LegalMarkdown } from "./legal-markdown";

export function LegalDocument({ source }: { source: string }) {
  return (
    <main className="legal-page">
      <article className="legal-page-card">
        <Link href="/sign-in" className="legal-wordmark-link">
          <OurDaysWordmark className="private-entry-wordmark" />
        </Link>
        {LEGAL_DRAFT_BANNER ? (
          <p className="legal-draft-banner" role="note">
            {LEGAL_DRAFT_BANNER}
          </p>
        ) : null}
        <LegalMarkdown source={source} />
      </article>
    </main>
  );
}
