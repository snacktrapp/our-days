import { describe, expect, it } from "vitest";
import {
  activityMomentHref,
  activityNotificationTitle,
  entryCommentMessage,
  entryReactionMessage,
  familyMomentPostedMessage,
  isNotifiableFamilyMoment,
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
    expect(activityMomentHref("abc")).toBe("/family#moment-abc");
    expect(activityMomentHref("abc", "circle-home")).toBe(
      "/family?circle=circle-home#moment-abc",
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
