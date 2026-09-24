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

export function mentionNotificationMessage(snippet: string) {
  const compact = snippet.replace(/\s+/gu, " ").trim();
  if (!compact) return "mentioned you.";
  const short =
    compact.length > 80 ? `${compact.slice(0, 79).trimEnd()}…` : compact;
  return `mentioned you. “${short}”`;
}

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

/**
 * One create or edit session is one family action. Only the first photo
 * in that batch should announce the moment; later media finishes stay quiet.
 */
export function shouldAnnouncePhotoMomentPublication(input: {
  announcePublication?: boolean;
  batchIndex?: number;
}) {
  if (input.announcePublication === false) return false;
  if (input.batchIndex !== undefined) return input.batchIndex === 0;
  return true;
}

export function activityNotificationTitle(actorName: string, message: string) {
  return `${actorName} ${message}`;
}

export type ActivityMomentTarget = Readonly<{
  noteId?: string | null;
  thread?: boolean;
}>;

/** All-circles journal. Circle feeds and person journals are never notification destinations. */
export function activityMomentHref(
  momentId: string,
  target?: ActivityMomentTarget | string | null,
) {
  const params = new URLSearchParams();
  params.set("moment", momentId);
  if (target && typeof target === "object") {
    if (target.noteId) params.set("note", target.noteId);
    if (target.thread) params.set("thread", "1");
  }
  return `/family?${params.toString()}`;
}

const momentHashPattern = /^#moment-(.+)$/;

export function normalizeNotificationPath(raw: string) {
  if (!raw.startsWith("/family")) return "/family";
  let url: URL;
  try {
    url = new URL(raw, "https://journal.local");
  } catch {
    return "/family";
  }
  if (url.pathname !== "/family") return "/family";
  const hashMoment = url.hash.match(momentHashPattern);
  if (hashMoment && !url.searchParams.get("moment")) {
    url.searchParams.set("moment", decodeURIComponent(hashMoment[1]));
  }
  url.searchParams.delete("circle");
  url.searchParams.delete("name");
  url.hash = "";
  const search = url.searchParams.toString();
  return search ? `/family?${search}` : "/family";
}

export function readNotificationTarget(href: string) {
  const path = normalizeNotificationPath(href);
  const params = new URL(path, "https://journal.local").searchParams;
  const momentId = params.get("moment");
  if (!momentId) return null;
  return {
    momentId,
    noteId: params.get("note"),
    openThread: params.get("thread") === "1" || Boolean(params.get("note")),
  };
}

export function nextNotificationPageHref(
  currentHref: string,
  nextHref: string,
) {
  const current = new URL(
    normalizeNotificationPath(currentHref),
    "https://journal.local",
  );
  let next: URL;
  try {
    next = new URL(nextHref, "https://journal.local");
  } catch {
    return null;
  }
  if (next.pathname !== "/family") return null;
  const moment = current.searchParams.get("moment");
  if (!moment) return null;
  next.searchParams.set("moment", moment);
  const note = current.searchParams.get("note");
  if (note) next.searchParams.set("note", note);
  if (current.searchParams.get("thread") === "1")
    next.searchParams.set("thread", "1");
  next.searchParams.delete("circle");
  next.searchParams.delete("name");
  next.hash = "";
  const search = next.searchParams.toString();
  return search ? `/family?${search}` : "/family";
}
