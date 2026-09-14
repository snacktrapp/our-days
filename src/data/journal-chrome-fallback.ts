import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import type { JournalAccess } from "@/lib/auth/journal-access";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

export function anonymousJournalAccess(): AuthenticatedAccess {
  return {
    mode: "authenticated",
    membershipId: "",
    circleId: "",
    personId: "",
    role: "member",
  };
}

export function fallbackJournalChrome(
  access: Readonly<{ circleId: string; personId: string }>,
  options: Readonly<{
    title: string;
    eyebrow: string;
    accent?: AccentToken;
  }>,
): JournalChromeViewModel {
  return {
    accent: options.accent ?? "slate",
    title: options.title,
    eyebrow: options.eyebrow,
    familyMark: [],
    composer: {
      experience: "connected-family",
      circleId: access.circleId,
      photoPostingEnabled: false,
      previewToday: "1970-01-01",
      defaultJournalPersonId: access.personId,
      recorderPersonId: access.personId,
      recordedByName: "You",
      journalPeople: [],
      taggablePeople: [],
    },
    timelineOptionsHref: "/trash",
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    notifications: [],
  };
}
