export function PlacePin({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={
        className ? `moment-place-pin ${className}` : "moment-place-pin"
      }
      viewBox="0 0 16 22"
      width="12"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 0C3.8 0 .3 3.5.3 7.7c0 5.4 7.7 14.3 7.7 14.3s7.7-8.9 7.7-14.3C15.7 3.5 12.2 0 8 0z"
        fill="currentColor"
      />
      <circle className="moment-place-pin-hole" cx="8" cy="7.6" r="3.1" />
    </svg>
  );
}
