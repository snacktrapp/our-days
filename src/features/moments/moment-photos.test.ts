import { describe, expect, it } from "vitest";
import {
  maximumMomentPhotos,
  orderMomentPhotos,
  parseMomentPhotoRows,
  photoAlbum,
  photoDeliverySrc,
  timelinePhotosFor,
} from "./moment-photos";

describe("moment photos", () => {
  it("caps an album at six photos", () => {
    expect(maximumMomentPhotos).toBe(6);
  });

  it("builds a private delivery URL for a specific photo", () => {
    expect(photoDeliverySrc("moment-1")).toBe("/api/media/moments/moment-1");
    expect(photoDeliverySrc("moment-1", "photo-2")).toBe(
      "/api/media/moments/moment-1?photo=photo-2",
    );
  });

  it("parses and orders photo rows by sort_order", () => {
    const parsed = parseMomentPhotoRows([
      { id: "b", sort_order: 2, display_width: 800, display_height: 600 },
      { id: "a", sort_order: 0 },
      { id: "c", sortOrder: 1 },
      { skipped: true },
    ]);
    expect(orderMomentPhotos(parsed).map((photo) => photo.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(parsed.find((photo) => photo.id === "b")).toMatchObject({
      width: 800,
      height: 600,
    });
  });

  it("maps loader rows onto ordered timeline photos", () => {
    const photos = timelinePhotosFor("moment-1", "Lake", [
      { id: "second", sortOrder: 1 },
      { id: "first", sortOrder: 0, width: 1200, height: 800 },
    ]);
    expect(photos).toEqual([
      {
        id: "first",
        src: "/api/media/moments/moment-1?photo=first",
        alt: "Lake",
        width: 1200,
        height: 800,
      },
      {
        id: "second",
        src: "/api/media/moments/moment-1?photo=second",
        alt: "Lake",
        width: undefined,
        height: undefined,
      },
    ]);
  });

  it("falls back to the first-photo route when no rows are loaded", () => {
    expect(timelinePhotosFor("moment-1", "Lake")).toEqual([
      { id: "moment-1", src: "/api/media/moments/moment-1", alt: "Lake" },
    ]);
  });

  it("uses a moment’s photos array, or the single image when the album is empty", () => {
    expect(
      photoAlbum({
        id: "moment-1",
        image: { src: "/one.jpg", alt: "One" },
        photos: [
          { id: "a", src: "/a.jpg", alt: "A" },
          { id: "b", src: "/b.jpg", alt: "B" },
        ],
      }).map((photo) => photo.id),
    ).toEqual(["a", "b"]);
    expect(
      photoAlbum({
        id: "moment-1",
        image: { src: "/one.jpg", alt: "One", width: 10, height: 8 },
      }),
    ).toEqual([
      {
        id: "moment-1",
        src: "/one.jpg",
        alt: "One",
        width: 10,
        height: 8,
      },
    ]);
  });
});
