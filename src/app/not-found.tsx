import { OurDaysWordmark } from "@/components/our-days-wordmark";
export default function NotFound() {
  return (
    <main className="private-entry-shell">
      <section className="private-entry-card" aria-labelledby="not-found-title">
        <OurDaysWordmark className="private-entry-wordmark" />
        <p>Private journal</p>
        <h1 id="not-found-title">That page isn’t here.</h1>
        <span>Your journal remains private.</span>
      </section>
    </main>
  );
}
