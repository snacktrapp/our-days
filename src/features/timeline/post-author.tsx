import { MomentPlaceButton } from "./moment-place-meta";
import { PlacePin } from "./place-pin";
import { shortPlaceLabel } from "@/lib/place-coordinates";
import type { TimelineMomentViewModel } from "./timeline-view-model";

export function PostAuthor({
  moment,
}: Readonly<{ moment: TimelineMomentViewModel }>) {
  const place = moment.placeName ? shortPlaceLabel(moment.placeName) : "";
  return (
    <div className="post-author">
      <span
        className={`post-author-avatar dot-${moment.personAccent}`}
        aria-hidden="true"
      >
        {moment.personInitial}
      </span>
      <strong>{moment.personName}</strong>
      {place ? (
        <span className="post-author-place">
          <span aria-hidden="true">·</span>
          <PlacePin />
          <MomentPlaceButton
            placeName={moment.placeName!}
            latitude={moment.latitude}
            longitude={moment.longitude}
          >
            {place}
          </MomentPlaceButton>
        </span>
      ) : null}
    </div>
  );
}
