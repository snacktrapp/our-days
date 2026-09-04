import { FullscreenMediaViewer } from "@/components/fullscreen-media-viewer";
import { CspPublicImage } from "@/components/csp-image";
import { PrivatePhotoImage } from "@/components/private-photo-image";
import { PrivateVideoPlayer } from "@/components/private-video-player";
import { PhotoLightboxTrigger } from "./photo-lightbox";
import { MomentConversationControl } from "./moment-conversation-control";
import { ConnectedMomentControl } from "@/features/moments/connected-moment-control";
import { parseBibleVerseMoment } from "@/features/composer/bible-verse-catalog";
import { insightSourceLabel } from "@/features/insights/insight-source";
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
  if (moment.kind === "insight") {
    return {
      ...base,
      kind: moment.kind,
      attribution: moment.attribution,
      sourceUrl: moment.sourceUrl,
      sourceLabel: moment.sourceLabel,
    };
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
            : moment.kind === "insight"
              ? "Insight"
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
                  width={moment.video.width}
                  height={moment.video.height}
                />
              }
              fullscreenMedia={
                <PrivateVideoPlayer
                  src={moment.video.src}
                  label={`Video in ${moment.personName}’s journal from ${moment.displayDate}`}
                  preload="metadata"
                  width={moment.video.width}
                  height={moment.video.height}
                />
              }
            />
          ) : (
            <PhotoLightboxTrigger
              src={moment.image.src}
              alt={moment.image.alt}
              width={moment.image.width}
              height={moment.image.height}
              reactionTargetId={moment.id}
            >
              {moment.image.delivery === "private" ? (
                <PrivatePhotoImage
                  src={moment.image.src}
                  alt={moment.image.alt}
                  width={moment.image.width}
                  height={moment.image.height}
                  highPriority={preload}
                />
              ) : (
                <CspPublicImage
                  src={moment.image.src}
                  alt={moment.image.alt}
                  width={moment.image.width ?? 1200}
                  height={moment.image.height ?? 801}
                  highPriority={preload}
                  sizes="(max-width: 520px) 92vw, 410px"
                />
              )}
            </PhotoLightboxTrigger>
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

  if (moment.kind === "insight") {
    const sourceHref = moment.sourceUrl;
    const sourceText =
      moment.sourceLabel ??
      (sourceHref ? insightSourceLabel(sourceHref) : undefined);
    return (
      <div className="moment-card thought-card bible-verse-card insight-card">
        <span className="thought-label">Insight</span>
        <ExpandableThoughtCopy
          momentId={moment.id}
          className="bible-verse-copy"
        >
          <span>“{moment.text}”</span>
          <cite>
            {moment.attribution}
            {sourceHref ? (
              <>
                {" · "}
                <a
                  className="insight-source"
                  href={sourceHref}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {sourceText}
                </a>
              </>
            ) : null}
          </cite>
        </ExpandableThoughtCopy>
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
