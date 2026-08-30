export function PrivateEntry() {
  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="private-entry-title"
      >
        <span className="private-entry-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>Private family journal</p>
        <h1 id="private-entry-title">Our Days is invitation only.</h1>
        <span>
          Sign-in will open here after the private circle boundary is connected.
        </span>
      </section>
    </main>
  );
}
