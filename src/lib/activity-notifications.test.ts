import { describe, expect, it } from "vitest";
import {
  activityMomentHref,
  activityNotificationTitle,
  entryCommentMessage,
  mentionNotificationMessage,
  entryReactionMessage,
  familyMomentPostedMessage,
  isNotifiableFamilyMoment,
  nextNotificationPageHref,
  normalizeNotificationPath,
  readNotificationTarget,
  shouldAnnouncePhotoMomentPublication,
} from "./activity-notifications";

describe("family activity notification copy", () => {
  it("keeps the quiet lock-screen sentences", () => {
    expect(
      activityNotificationTitle("Molly", familyMomentPostedMessage("photo")),
    ).toBe("Molly posted a photo.");
    expect(
      activityNotificationTitle("Heidi", entryReactionMessage("held-close")),
    ).toBe("Heidi loved your entry.");
    expect(activityNotificationTitle("Calvin", entryCommentMessage)).toBe(
      "Calvin commented on your entry.",
    );
    expect(
      activityNotificationTitle(
        "Molly",
        mentionNotificationMessage("the porch light"),
      ),
    ).toBe("Molly mentioned you. “the porch light”");
    expect(activityMomentHref("abc")).toBe("/family?moment=abc");
    expect(activityMomentHref("abc", { noteId: "note-1", thread: true })).toBe(
      "/family?moment=abc&note=note-1&thread=1",
    );
    expect(activityMomentHref("abc", { thread: true })).toBe(
      "/family?moment=abc&thread=1",
    );
  });

  it("routes every notification kind to the All circles entry", () => {
    expect(normalizeNotificationPath("/family?circle=home#moment-calvin")).toBe(
      "/family?moment=calvin",
    );
    expect(
      normalizeNotificationPath(
        "/family?circle=home&moment=calvin&note=reply&thread=1",
      ),
    ).toBe("/family?moment=calvin&note=reply&thread=1");
    expect(readNotificationTarget("/family?moment=calvin")).toEqual({
      momentId: "calvin",
      noteId: null,
      openThread: false,
    });
    expect(
      readNotificationTarget("/family?moment=calvin&note=reply&thread=1"),
    ).toEqual({
      momentId: "calvin",
      noteId: "reply",
      openThread: true,
    });
    expect(
      nextNotificationPageHref(
        "/family?moment=porch&note=n&thread=1",
        "/family?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
      ),
    ).toBe(
      "/family?pages=2&snapshot=2026-08-30T10%3A00%3A01Z&moment=porch&note=n&thread=1",
    );
  });

  it("does not notify the actor, Insights, or Just Me posts", () => {
    expect(
      isNotifiableFamilyMoment({
        authorMembershipId: "molly",
        viewerMembershipId: "molly",
        momentKind: "photo",
        audience: "family",
      }),
    ).toBe(false);
    expect(
      isNotifiableFamilyMoment({
        authorMembershipId: "molly",
        viewerMembershipId: "brian",
        momentKind: "insight",
        audience: "family",
      }),
    ).toBe(false);
    expect(
      isNotifiableFamilyMoment({
        authorMembershipId: "molly",
        viewerMembershipId: "brian",
        momentKind: "thought",
        audience: "just_me",
      }),
    ).toBe(false);
    expect(
      isNotifiableFamilyMoment({
        authorMembershipId: "molly",
        viewerMembershipId: "brian",
        momentKind: "photo",
        audience: "family",
      }),
    ).toBe(true);
  });

  it("announces one photo batch once, including an edit that adds several", () => {
    expect(shouldAnnouncePhotoMomentPublication({ batchIndex: 0 })).toBe(true);
    expect(shouldAnnouncePhotoMomentPublication({ batchIndex: 1 })).toBe(false);
    expect(shouldAnnouncePhotoMomentPublication({ batchIndex: 3 })).toBe(false);
    expect(
      shouldAnnouncePhotoMomentPublication({ announcePublication: false }),
    ).toBe(false);
    expect(
      shouldAnnouncePhotoMomentPublication({
        announcePublication: true,
        batchIndex: 0,
      }),
    ).toBe(true);
    expect(shouldAnnouncePhotoMomentPublication({})).toBe(true);
  });
});
