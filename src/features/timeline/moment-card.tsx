import { CspPublicImage } from "@/components/csp-image";
import { MomentReactionControl } from "./moment-reaction-control";
import type { TimelineMomentViewModel } from "./timeline-view-model";

function MomentActions({ moment }: { moment: TimelineMomentViewModel }) {
  return (
    <div className="soft-actions">
      <MomentReactionControl
        kicker={moment.kicker}
        personName={moment.personName}
      />
      <button
        aria-label={`Open ${moment.noteCount} notes for ${moment.kicker} by ${moment.personName}`}
      >
        Notes
      </button>
      {moment.taggedPeopleLabel && (
        <span className="tagged">with {moment.taggedPeopleLabel}</span>
      )}
    </div>
  );
}

type MomentCardProps = Readonly<{
  moment: TimelineMomentViewModel;
  preload?: boolean;
}>;

export function MomentCard({ moment, preload = false }: MomentCardProps) {
  if (moment.kind === "photo") {
    return (
      <div className="moment-card photo-card">
        <div className="photo-frame">
          <CspPublicImage
            src={moment.image.src}
            alt={moment.image.alt}
            width={1200}
            height={801}
            highPriority={preload}
            sizes="(max-width: 520px) 92vw, 410px"
          />
          <span className="photo-date">{moment.image.badgeLabel}</span>
        </div>
        <div className="card-copy">
          <p className="moment-kicker">{moment.kicker}</p>
          <p>{moment.text}</p>
          <MomentActions moment={moment} />
        </div>
      </div>
    );
  }

  if (moment.kind === "thought") {
    return (
      <div className="moment-card thought-card">
        <span className="thought-label">{moment.kicker}</span>
        <blockquote>“{moment.text}”</blockquote>
        <MomentActions moment={moment} />
      </div>
    );
  }

  if (moment.kind === "location") {
    return (
      <div className="moment-card location-card">
        <div className="memory-map" aria-hidden="true">
          <span className="map-water" />
          <span className="map-road road-one" />
          <span className="map-road road-two" />
          <span className="place-pin">
            <i />
          </span>
          <span className="map-label">{moment.mapLabel}</span>
        </div>
        <div className="card-copy">
          <p className="moment-kicker">{moment.kicker}</p>
          <h3>{moment.place}</h3>
          <p>{moment.text}</p>
          <MomentActions moment={moment} />
        </div>
      </div>
    );
  }

  return (
    <div className="moment-card milestone-card">
      <div className="milestone-seal">
        <span>{moment.ageLabel}</span>
        <strong aria-hidden="true">✦</strong>
        <span>{moment.yearLabel}</span>
      </div>
      <div className="milestone-copy">
        <span>{moment.kicker}</span>
        <h3>{moment.milestone}</h3>
        <p>{moment.text}</p>
        <MomentActions moment={moment} />
      </div>
    </div>
  );
}
