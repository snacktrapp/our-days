import { CspPublicImage } from "@/components/csp-image";
import { PrivatePhotoImage } from "@/components/private-photo-image";
import { photoAlbum } from "@/features/moments/moment-photos";
import { PhotoCardPager } from "./photo-card-pager";
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
import { VideoMomentMedia } from "./video-moment-media";
import { MomentPlaceButton, MomentPlaceMeta } from "./moment-place-meta";

function PhotoFrameSizer({
  width,
  height,
}: Readonly<{ width?: number; height?: number }>) {
  const sizerWidth = width && width > 0 ? width : 4;
  const sizerHeight = height && height > 0 ? height : 3;
  return (
    <svg
      className="photo-frame-sizer"
      viewBox={`0 0 ${sizerWidth} ${sizerHeight}`}
      aria-hidden="true"
      focusable="false"
    />
  );
}

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
    const mediaWidth = moment.kind === "photo" ? moment.image.width : undefined;
    const mediaHeight =
      moment.kind === "photo" ? moment.image.height : undefined;
    const knownRatio = Boolean(mediaWidth && mediaHeight);
    return (
      <div
        className={`moment-card photo-card ${moment.kind === "video" ? "video-card" : ""}`}
      >
        {moment.kind === "video" ? (
          <VideoMomentMedia
            moment={moment}
            label={`Video in ${moment.personName}’s journal from ${moment.displayDate}`}
          />
        ) : (
          <div
            className={`photo-frame has-reserved-frame${
              knownRatio ? " has-known-ratio" : ""
            }`}
          >
            <PhotoFrameSizer width={mediaWidth} height={mediaHeight} />
            <PhotoCardPager
              moment={moment}
              images={photoAlbum(moment).map((photo) =>
                moment.image.delivery === "private" ? (
                  <PrivatePhotoImage
                    key={photo.id}
                    src={photo.src}
                    alt={photo.alt}
                    width={photo.width}
                    height={photo.height}
                    highPriority={preload}
                  />
                ) : (
                  <CspPublicImage
                    key={photo.id}
                    src={photo.src}
                    alt={photo.alt}
                    width={photo.width ?? 1200}
                    height={photo.height ?? 801}
                    highPriority={preload}
                    sizes="(max-width: 520px) 92vw, 410px"
                  />
                ),
              )}
            />
          </div>
        )}
        <div className="card-copy">
          <div className="photo-card-heading">
            <MomentPlaceMeta
              heading
              typeLabel={typeLabel}
              placeName={moment.placeName}
              latitude={moment.latitude}
              longitude={moment.longitude}
            />
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
        <MomentPlaceMeta
          typeLabel={bibleVerse ? "Verse" : typeLabel}
          placeName={moment.placeName}
          latitude={moment.latitude}
          longitude={moment.longitude}
        />
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
          <h3>
            <MomentPlaceButton
              placeName={moment.place}
              latitude={moment.latitude}
              longitude={moment.longitude}
              className="moment-place-title"
            >
              {moment.place}
            </MomentPlaceButton>
          </h3>
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
        <MomentPlaceMeta
          typeLabel={typeLabel}
          placeName={moment.placeName}
          latitude={moment.latitude}
          longitude={moment.longitude}
        />
        <h3>{moment.milestone}</h3>
        <p>{moment.text}</p>
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
