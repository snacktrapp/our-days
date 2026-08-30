"use client";

import { useState } from "react";

type MomentReactionControlProps = Readonly<{
  kicker: string;
  personName: string;
}>;

export function MomentReactionControl({
  kicker,
  personName,
}: MomentReactionControlProps) {
  const [held, setHeld] = useState(false);
  return (
    <button
      className={held ? "held" : ""}
      aria-label={`${held ? "Release" : "Hold"} ${kicker} by ${personName}`}
      aria-pressed={held}
      onClick={() => setHeld((current) => !current)}
    >
      {held ? "♥ Held" : "♡ Hold"}
    </button>
  );
}
