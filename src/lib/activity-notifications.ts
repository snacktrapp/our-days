export const familyMomentPostedMessages = {
  thought: "posted a note.",
  photo: "posted a photo.",
  video: "posted a video.",
  location: "posted a place.",
  milestone: "posted a milestone.",
} as const;

export const entryReactionMessages = {
  "held-close": "loved your entry.",
  "made-me-smile": "smiled at your entry.",
  "remember-this": "remembered your entry.",
} as const;

export const entryCommentMessage = "commented on your entry.";

export type FamilyMomentPostedKind = keyof typeof familyMomentPostedMessages;
export type EntryReactionType = keyof typeof entryReactionMessages;

export function familyMomentPostedMessage(kind: string) {
  return (
    familyMomentPostedMessages[kind as FamilyMomentPostedKind] ??
    "posted an entry."
  );
}

export function entryReactionMessage(reactionType: string) {
  return (
    entryReactionMessages[reactionType as EntryReactionType] ??
    "reacted to your entry."
  );
}

export function isNotifiableFamilyMoment(input: {
  authorMembershipId: string;
  viewerMembershipId?: string;
  momentKind: string;
  audience?: string;
}) {
  return (
    input.authorMembershipId !== input.viewerMembershipId &&
    input.momentKind !== "insight" &&
    input.audience !== "just_me"
  );
}

export function activityNotificationTitle(actorName: string, message: string) {
  return `${actorName} ${message}`;
}

export function activityMomentHref(momentId: string) {
  return `/family#moment-${momentId}`;
}
