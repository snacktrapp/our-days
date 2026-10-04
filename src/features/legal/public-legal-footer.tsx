import Link from "next/link";

export function PublicLegalFooter() {
  return (
    <nav className="public-legal-footer" aria-label="Legal and support">
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/support">Support</Link>
      <p>
        <a href="mailto:team@beelinetech.co">team@beelinetech.co</a>
      </p>
    </nav>
  );
}
