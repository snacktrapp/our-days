import TimelinePrototype from '@/components/timeline/timeline-prototype';
import { connection } from 'next/server';

export default async function Home() {
  await connection();

  const designPreviewEnabled = process.env.NODE_ENV === 'development'
    || process.env.OUR_DAYS_ENABLE_DESIGN_PREVIEW === 'true';

  if (!designPreviewEnabled) {
    return (
      <main className="private-entry-shell">
        <section className="private-entry-card" aria-labelledby="private-entry-title">
          <span className="private-entry-mark" aria-hidden="true"><i /><i /><i /></span>
          <p>Private family journal</p>
          <h1 id="private-entry-title">Our Days is invitation only.</h1>
          <span>Sign-in will open here after the private circle boundary is connected.</span>
        </section>
      </main>
    );
  }

  return <TimelinePrototype />;
}
