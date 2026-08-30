import Link from "next/link";
import { MomentCard } from "./moment-card";
import type {
  TimelineEntryViewModel,
  TimelineMomentViewModel,
  TimelineViewModel,
} from "./timeline-view-model";

function Connection({ moment }: { moment: TimelineMomentViewModel }) {
  return (
    <div className="connection">
      <span
        className={`avatar-node dot-${moment.personAccent}`}
        aria-hidden="true"
      >
        {moment.personInitial}
      </span>
      <span className="moment-meta">
        <strong>{moment.personName}</strong>
        <span>{moment.displayTime}</span>
      </span>
    </div>
  );
}

function assertNever(entry: never): never {
  throw new Error(`Unsupported timeline entry: ${JSON.stringify(entry)}`);
}

type TimelineEntryProps = Readonly<{
  entry: TimelineEntryViewModel;
  firstMomentId?: string;
}>;

function TimelineEntry({ entry, firstMomentId }: TimelineEntryProps) {
  switch (entry.entryType) {
    case "date-marker":
      return (
        <div className={`date-marker ${entry.divider ? "year-divider" : ""}`}>
          <span>{entry.label}</span>
        </div>
      );
    case "elapsed-gap":
      return (
        <div className="elapsed-gap">
          <span>{entry.label}</span>
        </div>
      );
    case "moment":
      return (
        <article
          id={`moment-${entry.moment.id}`}
          className={`moment moment-${entry.moment.kind}`}
          data-moment-kind={entry.moment.kind}
        >
          <Connection moment={entry.moment} />
          <MomentCard
            moment={entry.moment}
            preload={entry.moment.id === firstMomentId}
          />
          <time dateTime={entry.moment.occurredOn}>
            {entry.moment.displayDate}
          </time>
        </article>
      );
    case "end-message":
      return (
        <>
          <div className="date-marker year-marker">
            <span>{entry.markerLabel}</span>
          </div>
          <p className="timeline-whisper">{entry.message}</p>
        </>
      );
    default:
      return assertNever(entry);
  }
}

export function TimelineFeed({ model }: { model: TimelineViewModel }) {
  const firstMomentId = model.entries.find(
    (entry) => entry.entryType === "moment",
  )?.moment.id;

  return (
    <>
      {model.switcher.length > 0 && (
        <div className="view-switch" role="group" aria-label="Timeline view">
          {model.switcher.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={item.current ? "page" : undefined}
              className={item.current ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}

      {model.personalIntro && (
        <div className="personal-intro">
          <span
            className={`profile-orbit dot-${model.personalIntro.accent}`}
            aria-hidden="true"
          >
            {model.personalIntro.initial}
          </span>
          <div>
            <strong>{model.personalIntro.title}</strong>
            <span>{model.personalIntro.summary}</span>
          </div>
        </div>
      )}

      <section className="timeline" aria-label="Chronological family moments">
        <div className="time-rail" aria-hidden="true" />
        {model.entries.map((entry) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            firstMomentId={firstMomentId}
          />
        ))}
      </section>
    </>
  );
}
