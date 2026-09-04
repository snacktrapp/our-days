import Link from "next/link";
import type { ReactNode } from "react";
import { MomentCard } from "./moment-card";
import type {
  TimelineEntryViewModel,
  TimelineMomentViewModel,
  TimelineViewModel,
} from "./timeline-view-model";
import type {
  ConnectedMomentActions,
  MomentConversationActions,
} from "@/features/moments/moment-action-types";
import { TimelineRefreshControl } from "./timeline-refresh-control";
import { TimelineScrollMemory } from "./timeline-scroll-memory";

const connectionMonths = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
] as const;

function connectionDate(occurredOn: string) {
  const [year, month, day] = occurredOn.split("-").map(Number);
  const monthLabel = connectionMonths[month - 1];
  return monthLabel && year && day
    ? `${monthLabel} ${day}, ${year}`
    : occurredOn;
}

function Connection({ moment }: { moment: TimelineMomentViewModel }) {
  const dateAndTime = moment.displayTime
    ? `${connectionDate(moment.occurredOn)} | ${moment.displayTime}`
    : connectionDate(moment.occurredOn);

  if (moment.kind === "insight") {
    return (
      <div className="connection connection-insight">
        <span className="insight-rail-node" aria-hidden="true" />
        <span className="moment-meta">
          <span>{dateAndTime}</span>
        </span>
      </div>
    );
  }

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
        <span>{dateAndTime}</span>
      </span>
    </div>
  );
}

function assertNever(entry: never): never {
  throw new Error(`Unsupported timeline entry: ${JSON.stringify(entry)}`);
}

function preciseEndCopy(markerLabel: string, message: string) {
  if (markerLabel === "The beginning") {
    return {
      markerLabel: "Earliest entry",
      message: "No earlier entries.",
    };
  }

  return { markerLabel, message };
}

type TimelineEntryProps = Readonly<{
  entry: TimelineEntryViewModel;
  firstMomentId?: string;
  interaction: TimelineViewModel["interaction"];
  connectedActions?: ConnectedMomentActions;
  conversationActions?: MomentConversationActions;
  connectedPosition?: number;
  connectedTotal?: number;
}>;

function TimelineEntry({
  entry,
  firstMomentId,
  interaction,
  connectedActions,
  conversationActions,
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
            conversationActions={conversationActions}
            connectedPosition={connectedPosition}
            connectedTotal={connectedTotal}
          />
          <time className="sr-only" dateTime={entry.moment.occurredOn}>
            {entry.moment.displayDate}
          </time>
        </article>
      );
    case "end-message":
      const endCopy = preciseEndCopy(entry.markerLabel, entry.message);
      return (
        <>
          <div className="date-marker year-marker">
            <span>{endCopy.markerLabel}</span>
          </div>
          {endCopy.message === "No earlier entries." ? null : (
            <p className="timeline-whisper">{endCopy.message}</p>
          )}
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
  conversationActions,
  pendingEntries,
}: {
  model: TimelineViewModel;
  connectedActions?: ConnectedMomentActions;
  conversationActions?: MomentConversationActions;
  pendingEntries?: ReactNode;
}) {
  const firstMomentId = model.entries.find(
    (entry) => entry.entryType === "moment",
  )?.moment.id;
  const connectedMomentIds = model.entries.flatMap((entry) =>
    entry.entryType === "moment" ? [entry.moment.id] : [],
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
      <TimelineRefreshControl>
        {pendingEntries}

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
              conversationActions={conversationActions}
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
      </TimelineRefreshControl>
    </>
  );
}
