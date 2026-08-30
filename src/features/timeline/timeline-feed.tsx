import Link from "next/link";
import { MomentCard } from "./moment-card";
import type {
  TimelineEntryViewModel,
  TimelineMomentViewModel,
  TimelineViewModel,
} from "./timeline-view-model";
import type { ConnectedMomentActions } from "@/features/moments/moment-action-types";
import { TimelineScrollMemory } from "./timeline-scroll-memory";

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
        {moment.displayTime ? <span>{moment.displayTime}</span> : null}
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
  interaction: TimelineViewModel["interaction"];
  connectedActions?: ConnectedMomentActions;
  connectedPosition?: number;
  connectedTotal?: number;
}>;

function TimelineEntry({
  entry,
  firstMomentId,
  interaction,
  connectedActions,
  connectedPosition,
  connectedTotal,
}: TimelineEntryProps) {
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
            interaction={interaction}
            moment={entry.moment}
            preload={entry.moment.id === firstMomentId}
            connectedActions={connectedActions}
            connectedPosition={connectedPosition}
            connectedTotal={connectedTotal}
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
    case "empty-state":
      return (
        <div className="timeline-empty-state">
          <strong>{entry.title}</strong>
          <span>{entry.message}</span>
        </div>
      );
    default:
      return assertNever(entry);
  }
}

export function TimelineFeed({
  model,
  connectedActions,
}: {
  model: TimelineViewModel;
  connectedActions?: ConnectedMomentActions;
}) {
  const firstMomentId = model.entries.find(
    (entry) => entry.entryType === "moment",
  )?.moment.id;
  const connectedMomentIds = model.entries.flatMap((entry) =>
    entry.entryType === "moment" && entry.moment.kind === "thought"
      ? [entry.moment.id]
      : [],
  );
  const connectedPositionById = new Map(
    connectedMomentIds.map((id, index) => [id, index + 1]),
  );

  return (
    <>
      {connectedActions ? (
        <TimelineScrollMemory
          key={
            model.pagination?.nextHref ??
            model.paginationError?.retryHref ??
            `complete-${model.entries.length}`
          }
        />
      ) : null}
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

      <section
        className="timeline"
        aria-label={model.timelineLabel ?? "Chronological family moments"}
        tabIndex={-1}
      >
        <div className="time-rail" aria-hidden="true" />
        {model.entries.map((entry) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            firstMomentId={firstMomentId}
            interaction={model.interaction}
            connectedActions={connectedActions}
            connectedPosition={
              entry.entryType === "moment"
                ? connectedPositionById.get(entry.moment.id)
                : undefined
            }
            connectedTotal={connectedMomentIds.length}
          />
        ))}
        {model.pagination ? (
          <div className="timeline-pagination">
            <Link
              href={model.pagination.nextHref}
              prefetch={false}
              replace
              scroll={false}
            >
              {model.pagination.label}
            </Link>
          </div>
        ) : null}
        {model.paginationError ? (
          <div className="timeline-pagination-error" role="alert">
            <span>{model.paginationError.message}</span>
            <Link
              href={model.paginationError.retryHref}
              prefetch={false}
              replace
              scroll={false}
            >
              {model.paginationError.label}
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}
