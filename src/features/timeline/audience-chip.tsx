"use client";

import { useEffect, useRef, useState } from "react";
import type { MomentAudience } from "@/features/moments/moment-audience";

type AudienceChipProps = Readonly<{
  label: string;
  names?: readonly string[];
  audience?: MomentAudience;
}>;

export function AudienceChip({
  label,
  names,
  audience = "family",
}: AudienceChipProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const detailNames =
    names && names.length > 0
      ? names
      : audience === "just_me"
        ? ["Just me"]
        : [];

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  return (
    <div ref={rootRef} className="card-audience">
      <button
        type="button"
        className="audience-chip"
        aria-expanded={expanded}
        aria-label={`Audience, ${label}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          className={
            audience === "just_me"
              ? "audience-chip-face just-me-pill"
              : "audience-chip-face"
          }
        >
          {label}
        </span>
      </button>
      {expanded && detailNames.length > 0 ? (
        <div className="audience-chip-detail">
          <ul>
            {detailNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
