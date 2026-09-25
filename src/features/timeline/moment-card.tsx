import type { ReactNode } from "react";
import { CspPublicImage } from "@/components/csp-image";
import { PrivatePhotoImage } from "@/components/private-photo-image";
import { photoAlbum } from "@/features/moments/moment-photos";
import { PhotoCardPager } from "./photo-card-pager";
import { MomentConversationControl } from "./moment-conversation-control";
import { ConnectedMomentControl } from "@/features/moments/connected-moment-control";
import { parseBibleVerseMoment } from "@/features/composer/bible-verse-catalog";
import { insightSourceLabel } from "@/features/insights/insight-source";
import { ExpandableThoughtCopy } from "./expandable-thought-copy";
import { MentionText } from "@/features/mentions/mention-text";
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
import { MomentPlaceButton } from "./moment-place-meta";
import { PostAuthor } from "./post-author";
import { DoubleTapPhoto } from "./double-tap-photo";

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

function CardTopChrome({
  children,
  participants,
  options,
}: Readonly<{
  children: ReactNode;
  participants: ReactNode;
  options?: ReactNode;
}>) {
  return (
    <div className="card-top-chrome">
      {children}
      {participants}
      {options}
    </div>
  );
}

function cardOptions(
  moment: TimelineMomentViewModel,
  interaction: MomentInteractionViewModel | undefined,
  connectedActions: ConnectedMomentActions | undefined,
  connectedPosition?: number,
  connectedTotal?: number,
) {
  if (!connectedActions || !moment.canChange) return null;
  return (
    <ConnectedMomentControl
      moment={moment}
      actions={connectedActions}
      position={connectedPosition}
      total={connectedTotal}
      taggablePeople={interaction?.taggablePeople ?? []}
    />
  );
}

function mentionMembersForMoment(
  moment: TimelineMomentViewModel,
  interaction?: MomentInteractionViewModel,
) {
  if (
    !interaction?.mentionableMembers ||
    moment.audience === "just_me" ||
    moment.kind === "insight"
  ) {
    return [];
  }
  const circles = moment.linkedCircleIds?.length
    ? moment.linkedCircleIds
    : moment.circleId
      ? [moment.circleId]
      : [];
  const seen = new Set<string>();
  const members = [];
  for (const member of interaction.mentionableMembers) {
    if (circles.length > 0 && !circles.includes(member.circleId)) continue;
    if (seen.has(member.userId)) continue;
    seen.add(member.userId);
    members.push(member);
  }
  return members;
}

function CardActions({
  interaction,
  moment,
  conversationActions,
  connectedPosition,
  connectedTotal,
}: Readonly<{
  interaction?: MomentInteractionViewModel;
  moment: TimelineMomentViewModel;
  conversationActions?: MomentConversationActions;
  connectedPosition?: number;
  connectedTotal?: number;
}>) {
  if (interaction) {
    const mentionMembers = mentionMembersForMoment(moment, interaction);
    return (
      <MomentConversationControl
        interaction={interaction}
        model={detailModel(moment)}
        actions={conversationActions}
        position={connectedPosition}
        total={connectedTotal}
        mentionMembers={mentionMembers}
        mentionsEnabled={
          moment.audience !== "just_me" && moment.kind !== "insight"
        }
      />
    );
  }
  return null;
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
          <DoubleTapPhoto momentId={moment.id}>
            <div
              className={`photo-frame has-reserved-frame${
                knownRatio ? " has-known-ratio" : ""
              }`}
            >
              <PhotoFrameSizer width={mediaWidth} height={mediaHeight} />
              <PhotoCardPager
                moment={moment}
                images={photoAlbum(moment).map((photo, photoIndex) =>
                  moment.image.delivery === "private" ? (
                    <PrivatePhotoImage
                      key={photo.id}
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width}
                      height={photo.height}
                      highPriority={preload && photoIndex === 0}
                    />
                  ) : (
                    <CspPublicImage
                      key={photo.id}
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width ?? 1200}
                      height={photo.height ?? 801}
                      highPriority={preload && photoIndex === 0}
                      eager={photoIndex > 0}
                      sizes="(max-width: 520px) 92vw, 410px"
                    />
                  ),
                )}
              />
            </div>
          </DoubleTapPhoto>
        )}
        <div className="card-copy">
          <CardTopChrome
            participants={
              moment.taggedPeopleLabel ? (
                <span className="post-participants">
                  with {moment.taggedPeopleLabel}
                </span>
              ) : null
            }
            options={cardOptions(
              moment,
              interaction,
              connectedActions,
              connectedPosition,
              connectedTotal,
            )}
          >
            <PostAuthor moment={moment} />
          </CardTopChrome>
          <p>
            <MentionText text={moment.text} mentions={moment.mentions} />
          </p>
          <CardActions
            interaction={interaction}
            moment={moment}
            conversationActions={conversationActions}
            connectedPosition={connectedPosition}
            connectedTotal={connectedTotal}
          />
        </div>
      </div>
    );
  }

  if (moment.kind === "thought") {
    return (
      <div
        className={`moment-card thought-card ${bibleVerse ? "bible-verse-card" : ""}`}
      >
        <CardTopChrome
          participants={
            moment.taggedPeopleLabel ? (
              <span className="post-participants">
                with {moment.taggedPeopleLabel}
              </span>
            ) : null
          }
          options={cardOptions(
            moment,
            interaction,
            connectedActions,
            connectedPosition,
            connectedTotal,
          )}
        >
          <PostAuthor moment={moment} />
        </CardTopChrome>
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
            “<MentionText text={moment.text} mentions={moment.mentions} />”
          </ExpandableThoughtCopy>
        )}
        <CardActions
          interaction={interaction}
          moment={moment}
          conversationActions={conversationActions}
          connectedPosition={connectedPosition}
          connectedTotal={connectedTotal}
        />
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
        <CardTopChrome
          participants={null}
          options={cardOptions(
            moment,
            interaction,
            connectedActions,
            connectedPosition,
            connectedTotal,
          )}
        >
          <span className="thought-label">Insight</span>
        </CardTopChrome>
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
        {moment.video ? (
          <VideoMomentMedia
            moment={{ id: moment.id, video: moment.video }}
            label={`Clip attached to an Insight from ${moment.displayDate}`}
          />
        ) : null}
        <CardActions
          interaction={interaction}
          moment={moment}
          conversationActions={conversationActions}
          connectedPosition={connectedPosition}
          connectedTotal={connectedTotal}
        />
      </div>
    );
  }

  if (moment.kind === "location") {
    return (
      <div className="moment-card location-card">
        <div className="card-copy">
          <CardTopChrome
            participants={
              moment.taggedPeopleLabel ? (
                <span className="post-participants">
                  with {moment.taggedPeopleLabel}
                </span>
              ) : null
            }
            options={cardOptions(
              moment,
              interaction,
              connectedActions,
              connectedPosition,
              connectedTotal,
            )}
          >
            <PostAuthor moment={moment} />
          </CardTopChrome>
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
          <p>
            <MentionText text={moment.text} mentions={moment.mentions} />
          </p>
          <CardActions
            interaction={interaction}
            moment={moment}
            conversationActions={conversationActions}
            connectedPosition={connectedPosition}
            connectedTotal={connectedTotal}
          />
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
        <CardTopChrome
          participants={
            moment.taggedPeopleLabel ? (
              <span className="post-participants">
                with {moment.taggedPeopleLabel}
              </span>
            ) : null
          }
          options={cardOptions(
            moment,
            interaction,
            connectedActions,
            connectedPosition,
            connectedTotal,
          )}
        >
          <PostAuthor moment={moment} />
        </CardTopChrome>
        <h3>{moment.milestone}</h3>
        <p>
          <MentionText text={moment.text} mentions={moment.mentions} />
        </p>
      </div>
      <CardActions
        interaction={interaction}
        moment={moment}
        conversationActions={conversationActions}
        connectedPosition={connectedPosition}
        connectedTotal={connectedTotal}
      />
    </div>
  );
}
