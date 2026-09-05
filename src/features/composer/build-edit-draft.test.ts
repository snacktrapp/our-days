import { describe, expect, it, vi } from "vitest";
import {
  formatBibleVerseMoment,
  selectBiblePassage,
} from "./bible-verse-catalog";
import { buildComposerEditDraft } from "./build-edit-draft";
import type {
  LocationMomentViewModel,
  PhotoMomentViewModel,
  ThoughtMomentViewModel,
  VideoMomentViewModel,
} from "@/features/timeline/timeline-view-model";

const save = vi.fn();

const thought = {
  id: "moment-1",
  journalPersonId: "person-1",
  kind: "thought",
  personName: "Brian",
  personInitial: "B",
  personAccent: "teal",
  displayDate: "Aug 28, 2026",
  occurredOn: "2026-08-28",
  maxOccurredOn: "2026-08-30",
  kicker: "A thought",
  text: "Worth keeping.",
  placeName: "Cedar Park",
  conversation: { notes: [], reactions: [] },
  canChange: true,
  revision: 1,
  taggedPeople: [{ id: "molly", name: "Molly" }],
  editOccurrence: { occurredAt: null, timeZone: null },
} as const satisfies ThoughtMomentViewModel;

describe("buildComposerEditDraft", () => {
  it("builds a written-entry draft from a note", () => {
    expect(buildComposerEditDraft(thought, save)).toEqual(
      expect.objectContaining({
        mode: "thought",
        body: "Worth keeping.",
        title: "",
        place: {
          label: "Cedar Park",
          latitude: null,
          longitude: null,
        },
        taggedPersonIds: ["molly"],
      }),
    );
  });

  it("builds a bible-verse draft from WEB text", async () => {
    const passage = await selectBiblePassage("Isaiah", 40, 28, 28);
    expect(passage).not.toBeNull();
    const draft = buildComposerEditDraft(
      {
        ...thought,
        text: formatBibleVerseMoment(passage!.reference, passage!.text),
      },
      save,
    );
    expect(draft).toEqual(
      expect.objectContaining({
        mode: "bible-verse",
        title: "Isaiah 40:28",
        body: passage!.text,
        verseSelection: {
          book: "Isaiah",
          chapter: 40,
          startVerse: 28,
          endVerse: 28,
        },
      }),
    );
  });

  it("builds photo and location drafts with the create composer modes", () => {
    const photo = {
      ...thought,
      kind: "photo",
      text: "At the lake",
      image: {
        src: "/api/media/moments/moment-1",
        alt: "Lake",
        badgeLabel: "Aug 28, 2026",
        delivery: "private",
      },
    } as const satisfies PhotoMomentViewModel;
    const location = {
      ...thought,
      kind: "location",
      place: "Cedar Park",
      mapLabel: "Remembered here",
      text: "The wind made everyone laugh.",
    } as const satisfies LocationMomentViewModel;
    const video = {
      ...thought,
      kind: "video",
      text: "",
      video: { src: "/api/media/videos/moment-1" },
    } as const satisfies VideoMomentViewModel;

    expect(buildComposerEditDraft(photo, save)?.existingMedia).toEqual({
      kind: "photo",
      src: "/api/media/moments/moment-1",
      alt: "Lake",
      photos: [
        { src: "/api/media/moments/moment-1", alt: "Lake" },
      ],
    });
    expect(buildComposerEditDraft(location, save)).toEqual(
      expect.objectContaining({
        mode: "location",
        title: "Cedar Park",
        body: "The wind made everyone laugh.",
      }),
    );
    expect(buildComposerEditDraft(video, save)?.mode).toBe("video");
  });
});
