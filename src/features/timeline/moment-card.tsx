import { FullscreenMediaViewer } from "@/components/fullscreen-media-viewer";
import { CspPublicImage } from "@/components/csp-image";
import { PrivatePhotoImage } from "@/components/private-photo-image";
import { PrivateVideoPlayer } from "@/components/private-video-player";
import { MomentConversationControl } from "./moment-conversation-control";
import { ConnectedMomentControl } from "@/features/moments/connected-moment-control";
import { parseBibleVerseMoment } from "@/features/composer/bible-verse-catalog";
import { ExpandableThoughtCopy } from "./expandable-thought-copy";
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

  if (moment.kind === "photo" || moment.kind === "video") {
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
  const bibleVerseMatch =
    moment.kind === "thought" ? parseBibleVerseMoment(moment.text) : null;
  const bibleVerse = bibleVerseMatch
    ? { verse: bibleVerseMatch.text, reference: bibleVerseMatch.reference }
    : null;
  const typeLabel =
    moment.kind === "thought"
      ? "Note"
      : moment.kind === "video"
        ? "Video"
        : moment.kind === "location"
          ? "Location"
          : moment.kind === "milestone"
            ? "Milestone"
            : "Photo";

  if (moment.kind === "photo" || moment.kind === "video") {
    return (
      <div
        className={`moment-card photo-card ${moment.kind === "video" ? "video-card" : ""}`}
      >
        <div
          className={`photo-frame ${moment.kind === "video" ? "video-frame" : ""}`}
        >
          {moment.kind === "video" ? (
            <FullscreenMediaViewer
              kind="video"
              label={`Video in ${moment.personName}’s journal from ${moment.displayDate}`}
              reactionTargetId={moment.id}
              preview={
                <PrivateVideoPlayer
                  src={moment.video.src}
                  label={`Video in ${moment.personName}’s journal from ${moment.displayDate}`}
                  preload={preload ? "metadata" : "none"}
                  controls={false}
                />
              }
              fullscreenMedia={
                <PrivateVideoPlayer
                  src={moment.video.src}
                  label={`Video in ${moment.personName}’s journal from ${moment.displayDate}`}
                  preload="metadata"
                />
              }
            />
          ) : (
            <FullscreenMediaViewer
              kind="photo"
              label={moment.image.alt}
              reactionTargetId={moment.id}
              preview={
                moment.image.delivery === "private" ? (
                  <PrivatePhotoImage
                    src={moment.image.src}
                    alt={moment.image.alt}
                    width={1200}
                    height={801}
                    highPriority={preload}
                  />
                ) : (
                  <CspPublicImage
                    src={moment.image.src}
                    alt={moment.image.alt}
                    width={1200}
                    height={801}
                    highPriority={preload}
                    sizes="(max-width: 520px) 92vw, 410px"
                  />
                )
              }
              fullscreenMedia={
                moment.image.delivery === "private" ? (
                  <PrivatePhotoImage
                    src={moment.image.src}
                    alt={moment.image.alt}
                    width={1600}
                    height={1068}
                    highPriority
                  />
                ) : (
                  <CspPublicImage
                    src={moment.image.src}
                    alt={moment.image.alt}
                    width={1600}
                    height={1068}
                    highPriority
                    sizes="100vw"
                  />
                )
              }
            />
          )}
        </div>
        <div className="card-copy">
          <div className="photo-card-heading">
            <p className="moment-kicker">{typeLabel}</p>
            {connectedActions && moment.canChange ? (
              <ConnectedMomentControl
                moment={moment}
                actions={connectedActions}
                position={connectedPosition}
                total={connectedTotal}
                taggablePeople={interaction?.taggablePeople ?? []}
              />
            ) : null}
          </div>
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
      <div
        className={`moment-card thought-card ${bibleVerse ? "bible-verse-card" : ""}`}
      >
        <span className="thought-label">
          {bibleVerse ? "Bible verse" : typeLabel}
        </span>
        {bibleVerse ? (
          <ExpandableThoughtCopy
            momentId={moment.id}
            className="bible-verse-copy"
          >
            <span>“{bibleVerse.verse}”</span>
            <cite>{bibleVerse.reference} · World English Bible</cite>
          </ExpandableThoughtCopy>
        ) : (
          <ExpandableThoughtCopy momentId={moment.id}>
            “{moment.text}”
          </ExpandableThoughtCopy>
        )}
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
        {connectedActions && moment.canChange ? (
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
        </div>
        <div className="card-copy">
          <div className="location-card-heading">
            <p className="moment-kicker">{typeLabel}</p>
            {connectedActions && moment.canChange ? (
              <ConnectedMomentControl
                moment={moment}
                actions={connectedActions}
                position={connectedPosition}
                total={connectedTotal}
                taggablePeople={interaction?.taggablePeople ?? []}
              />
            ) : null}
          </div>
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
        <span>{typeLabel}</span>
        <h3>{moment.milestone}</h3>
        <p>{moment.text}</p>
        {moment.placeName ? (
          <p className="moment-place-label">⌖ {moment.placeName}</p>
        ) : null}
      </div>
      {interaction ? (
        <MomentConversationControl
          interaction={interaction}
          model={detailModel(moment)}
          actions={conversationActions}
          position={connectedPosition}
          total={connectedTotal}
        />
      ) : null}
      {connectedActions && moment.canChange ? (
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
