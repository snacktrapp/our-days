export function HeartGlyph({ filled = false }: Readonly<{ filled?: boolean }>) {
  return (
    <svg
      className="heart-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.5 9c0 5-8.5 11-8.5 11S3.5 14 3.5 9a4.75 4.75 0 0 1 8.5-2.9A4.75 4.75 0 0 1 20.5 9Z" />
    </svg>
  );
}
