export const currentTermsVersion = "2026-10-04";

export const reportReasons = [
  ["harassment", "Harassment"],
  ["hate", "Hate"],
  ["sexual", "Sexual content"],
  ["violence", "Violence"],
  ["child_safety", "Child safety"],
  ["spam", "Spam"],
  ["other", "Other"],
] as const;

export type ReportReason = (typeof reportReasons)[number][0];

export const reportThanks =
  "Thanks — our team reviews reports within 24 hours.";

export const zeroTolerance =
  "We have zero tolerance for objectionable content and abusive behavior.";

export const deletionConfirmation =
  "Your account and the posts, photos, videos, comments, and hearts you created will be deleted within 7 days. Other people's posts stay. Tags and mentions of you are removed.";

export const safetyContactEmail = "team@beelinetech.co";
