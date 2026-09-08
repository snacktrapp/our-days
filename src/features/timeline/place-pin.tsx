export function PlacePin({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      className={
        className ? `moment-place-pin ${className}` : "moment-place-pin"
      }
      aria-hidden="true"
    >
      <i />
    </span>
  );
}
