// Shared by the streamed loading shell and the interactive navigation.
export function NavSymbol({ name }: { name: "family" | "add" | "circles" }) {
  return (
    <span className="nav-symbol" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {name === "family" ? (
          <>
            <path d="M12 11.2v1.6" strokeWidth={2.15} />
            <rect x="5.5" y="5" width="13" height="5.2" rx="1.6" />
            <rect x="5.5" y="13.8" width="13" height="5.2" rx="1.6" />
          </>
        ) : name === "add" ? (
          <path d="M12 5v14M5 12h14" />
        ) : (
          <>
            <circle cx="9" cy="8" r="3" />
            <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.65" />
          </>
        )}
      </svg>
    </span>
  );
}
