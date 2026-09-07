import { CspPublicImage } from "@/components/csp-image";
import { FullscreenMediaViewer } from "@/components/fullscreen-media-viewer";
import { PrivatePhotoImage } from "@/components/private-photo-image";
import { PrivateVideoPlayer } from "@/components/private-video-player";
import { useVideoPoster } from "@/features/video/video-poster-store";
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
  VideoMomentViewModel,
} from "./timeline-view-model";

function VideoMomentMedia({
  moment,
  label,
}: Readonly<{
  moment: VideoMomentViewModel;
  label: string;
}>) {
  const storedPoster = useVideoPoster(moment.id);
  const poster = moment.video.poster ?? storedPoster ?? undefined;
  return (
    <FullscreenMediaViewer
      kind="video"
      label={label}
      reactionTargetId={moment.id}
      preview={
        poster ? (
          // Poster is a local data URL captured during prep; it must not
          // enter the public image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="video-card-poster"
            src={poster}
            alt=""
            width={moment.video.width}
            height={moment.video.height}
          />
        ) : (
          <div className="video-card-mat" aria-hidden="true" />
        )
      }
      fullscreenMedia={
        <PrivateVideoPlayer
          src={moment.video.src}
          label={label}
          poster={poster}
          preload="metadata"
          autoPlay
          width={moment.video.width}
          height={moment.video.height}
        />
      }
    />
  );
}

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
    const mediaWidth =
      moment.kind === "video" ? moment.video.width : moment.image.width;
    const mediaHeight =
      moment.kind === "video" ? moment.video.height : moment.image.height;
    const knownRatio = Boolean(mediaWidth && mediaHeight);
    return (
      <div
        className={`moment-card photo-card ${moment.kind === "video" ? "video-card" : ""}`}
      >
        <div
          className={`photo-frame has-reserved-frame ${moment.kind === "video" ? "video-frame" : ""}${
            knownRatio ? " has-known-ratio" : ""
          }`}
        >
          <PhotoFrameSizer width={mediaWidth} height={mediaHeight} />
          {moment.kind === "video" ? (
            <VideoMomentMedia
              moment={moment}
              label={`Video in ${moment.personName}’s journal from ${moment.displayDate}`}
            />
          ) : (
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
