import type { TimelinePhotoView } from "@/features/timeline/timeline-view-model";

export const maximumMomentPhotos = 6;

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
