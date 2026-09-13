import type { MomentAudience } from "@/features/moments/moment-audience";

type AudienceChipProps = Readonly<{
  label: string;
  audience?: MomentAudience;
}>;

export function AudienceChip({
  label,
  audience = "family",
}: AudienceChipProps) {
  return (
    <div className="card-audience">
      <span className="audience-chip" aria-label={`Audience, ${label}`}>
        <span
          className={
            audience === "just_me"
              ? "audience-chip-face just-me-pill"
              : "audience-chip-face"
          }
        >
          {label}
        </span>
      </span>
    </div>
  );
}
