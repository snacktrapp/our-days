import type { TimelinePhotoView } from "@/features/timeline/timeline-view-model";

export const maximumMomentPhotos = 6;

// Phone cards at 390 CSS px and DPR 3 need about 1170 px. 1080 is the card
// width; 640 is the smaller thumbnail width. Anything else is rejected.
export const timelineCardPhotoWidths = [640, 1080] as const;
export type TimelineCardPhotoWidth = (typeof timelineCardPhotoWidths)[number];
export const timelineCardPhotoWidth = 1080 satisfies TimelineCardPhotoWidth;

export type MomentPhotoDescriptor = Readonly<{
  id: string;
  sortOrder: number;
  width?: number;
  height?: number;
}>;

export function photoDeliverySrc(momentId: string, photoId?: string) {
  if (!photoId) return `/api/media/moments/${momentId}`;
  return `/api/media/moments/${momentId}?photo=${encodeURIComponent(photoId)}`;
}

export function isTimelineCardPhotoWidth(
  value: string | null,
): value is `${TimelineCardPhotoWidth}` {
  return value === "640" || value === "1080";
}

export function timelineCardPhotoSrc(momentId: string, photoId?: string) {
  const params = new URLSearchParams();
  if (photoId) params.set("photo", photoId);
  params.set("w", String(timelineCardPhotoWidth));
  return `/api/media/moments/${momentId}?${params.toString()}`;
}

// The delivery route serves the first photo by sort order when photo is
// omitted, so the opening card can name this URL before enrichment.
export function openingTimelinePhotoSrc(
  rows: readonly { moment_id: string; moment_kind?: string }[],
) {
  const first = rows[0];
  if (!first || first.moment_kind !== "photo") return null;
  return timelineCardPhotoSrc(first.moment_id);
}

export function parseMomentPhotoRows(value: unknown): MomentPhotoDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): MomentPhotoDescriptor[] => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("id" in row) ||
      typeof row.id !== "string"
    ) {
      return [];
    }
    const sortOrder =
      "sort_order" in row && typeof row.sort_order === "number"
        ? row.sort_order
        : "sortOrder" in row && typeof row.sortOrder === "number"
          ? row.sortOrder
          : 0;
    const width =
      "display_width" in row && typeof row.display_width === "number"
        ? row.display_width
        : "width" in row && typeof row.width === "number"
          ? row.width
          : undefined;
    const height =
      "display_height" in row && typeof row.display_height === "number"
        ? row.display_height
        : "height" in row && typeof row.height === "number"
          ? row.height
          : undefined;
    return [{ id: row.id, sortOrder, width, height }];
  });
}

export function orderMomentPhotos<T extends { sortOrder: number }>(
  photos: readonly T[],
) {
  return [...photos].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function timelinePhotosFor(
  momentId: string,
  alt: string,
  rows?: readonly MomentPhotoDescriptor[],
): readonly TimelinePhotoView[] {
  const ordered = orderMomentPhotos(rows ?? []);
  if (ordered.length === 0) {
    return [{ id: momentId, src: photoDeliverySrc(momentId), alt }];
  }
  return ordered.map((photo) => ({
    id: photo.id,
    src: photoDeliverySrc(momentId, photo.id),
    alt,
    width: photo.width,
    height: photo.height,
  }));
}

export function photoAlbum(
  moment: Readonly<{
    id: string;
    image: Readonly<{
      src: string;
      alt: string;
      width?: number;
      height?: number;
    }>;
    photos?: readonly TimelinePhotoView[];
  }>,
): readonly TimelinePhotoView[] {
  if (moment.photos && moment.photos.length > 0) return moment.photos;
  return [
    {
      id: moment.id,
      src: moment.image.src,
      alt: moment.image.alt,
      width: moment.image.width,
      height: moment.image.height,
    },
  ];
}
