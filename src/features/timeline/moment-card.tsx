import { CspPublicImage } from "@/components/csp-image";
import { MomentConversationControl } from "./moment-conversation-control";
import { ConnectedMomentControl } from "@/features/moments/connected-moment-control";
import type {
  ConnectedMomentActions,
  MomentConversationActions,
} from "@/features/moments/moment-action-types";
import type {
  MomentDetailViewModel,
  MomentInteractionViewModel,
  TimelineMomentViewModel,
} from "./timeline-view-model";

function detailModel(moment: TimelineMomentViewModel): MomentDetailViewModel {
  const base = {
    id: moment.id,
    personName: moment.personName,
    personAccent: moment.personAccent,
    displayDate: moment.displayDate,
    kicker: moment.kicker,
    text: moment.text,
    conversation: moment.conversation,
    taggedPeopleLabel: moment.taggedPeopleLabel,
    placeName: moment.placeName,
  };

  if (moment.kind === "photo") {
    return { ...base, kind: moment.kind };
  }
  if (moment.kind === "location") {
    return { ...base, kind: moment.kind, place: moment.place };
  }
  if (moment.kind === "milestone") {
    return { ...base, kind: moment.kind, milestone: moment.milestone };
  }
  return { ...base, kind: moment.kind };
}

type MomentCardProps = Readonly<{
  interaction?: MomentInteractionViewModel;
  moment: TimelineMomentViewModel;
  preload?: boolean;
  connectedActions?: ConnectedMomentActions;
  conversationActions?: MomentConversationActions;
  connectedPosition?: number;
  connectedTotal?: number;
}>;

export function MomentCard({
  interaction,
  moment,
  preload = false,
  connectedActions,
  conversationActions,
  connectedPosition,
  connectedTotal,
}: MomentCardProps) {
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
          {interaction ? (
            <MomentConversationControl
              interaction={interaction}
              model={detailModel(moment)}
              actions={conversationActions}
              position={connectedPosition}
              total={connectedTotal}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (moment.kind === "thought") {
    return (
      <div className="moment-card thought-card">
        <span className="thought-label">{moment.kicker}</span>
        <blockquote>“{moment.text}”</blockquote>
        {moment.placeName ? (
          <p className="moment-place-label">⌖ {moment.placeName}</p>
        ) : null}
        {interaction ? (
          <MomentConversationControl
            interaction={interaction}
            model={detailModel(moment)}
            actions={conversationActions}
            position={connectedPosition}
            total={connectedTotal}
          />
        ) : null}
        {connectedActions ? (
          <ConnectedMomentControl
            moment={moment}
            actions={connectedActions}
            position={connectedPosition}
            total={connectedTotal}
            taggablePeople={interaction?.taggablePeople ?? []}
          />
        ) : null}
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
          {interaction ? (
            <MomentConversationControl
              interaction={interaction}
              model={detailModel(moment)}
              actions={conversationActions}
              position={connectedPosition}
              total={connectedTotal}
            />
          ) : null}
          {connectedActions ? (
            <ConnectedMomentControl
              moment={moment}
              actions={connectedActions}
              position={connectedPosition}
              total={connectedTotal}
              taggablePeople={interaction?.taggablePeople ?? []}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="moment-card milestone-card">
      <div className="milestone-seal">
        {moment.ageLabel ? <span>{moment.ageLabel}</span> : null}
        <strong aria-hidden="true">✦</strong>
        {moment.yearLabel ? <span>{moment.yearLabel}</span> : null}
      </div>
      <div className="milestone-copy">
        <span>{moment.kicker}</span>
        <h3>{moment.milestone}</h3>
        <p>{moment.text}</p>
        {moment.placeName ? (
          <p className="moment-place-label">⌖ {moment.placeName}</p>
        ) : null}
        {interaction ? (
          <MomentConversationControl
            interaction={interaction}
            model={detailModel(moment)}
            actions={conversationActions}
            position={connectedPosition}
            total={connectedTotal}
          />
        ) : null}
        {connectedActions ? (
          <ConnectedMomentControl
            moment={moment}
            actions={connectedActions}
            position={connectedPosition}
            total={connectedTotal}
            taggablePeople={interaction?.taggablePeople ?? []}
          />
        ) : null}
      </div>
    </div>
  );
}
