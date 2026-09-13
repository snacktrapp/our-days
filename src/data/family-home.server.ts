import "server-only";

import {
  allHomeLabel,
  buildJournalSwitcher,
  journalSwitcherEyebrow,
} from "@/features/shell/journal-switcher";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import type { TimelineViewModel } from "@/features/timeline/timeline-view-model";
import { isFatalJournalHomeError } from "@/lib/auth/family-session-error";
import type { JournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "./journal-context.server";
import {
  connectedTimelineInteraction,
  loadConnectedTimeline,
} from "./moments.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

function fallbackFamilyChrome(
  access: AuthenticatedAccess,
): JournalChromeViewModel {
  return {
    accent: "slate",
    title: allHomeLabel,
    eyebrow: "Circles",
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

function remountSoftFailTimeline(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>> | null,
  allCircles: boolean,
): TimelineViewModel {
  const chrome = context
    ? allCircles
      ? { ...context.chrome, title: allHomeLabel }
      : context.chrome
    : fallbackFamilyChrome(access);
  const switcher = buildJournalSwitcher({
    groups: context?.groups,
    groupLabel: context?.circleName,
    people: context?.people ?? [],
    viewerPersonId: access.personId,
    viewerPersonIds: context?.viewerPersonIds,
    currentHref: allCircles ? "/family" : `/family?circle=${access.circleId}`,
    activeGroupId: allCircles ? null : access.circleId,
  });
  return {
    chrome: {
      ...chrome,
      eyebrow: journalSwitcherEyebrow(switcher),
    },
    switcher,
    timelineLabel: "Chronological family moments",
    interaction: context
      ? connectedTimelineInteraction(access, context)
      : {
          audienceName: "Family",
          currentPerson: {
            name: "You",
            initial: "•",
            accent: "slate",
          },
          taggablePeople: [],
          reactionOptions: [
            { id: "held-close", label: "Held close", symbol: "♡" },
            { id: "made-me-smile", label: "Made me smile", symbol: "◡" },
            { id: "remember-this", label: "Remember this", symbol: "✦" },
          ],
        },
    entries: [
      {
        id: "journal-load-soft-fail",
        entryType: "empty-state",
        title: "These days couldn’t open",
        message: "Try again in a moment. Nothing here was lost.",
      },
    ],
    paginationError: {
      retryHref: allCircles ? "/family" : `/family?circle=${access.circleId}`,
      message:
        "The journal couldn’t open these days just now. Nothing here was lost.",
      label: "Try opening the journal again",
    },
  };
}

export function shouldTrapJournalHomeInInterrupt(error: unknown) {
  return isFatalJournalHomeError(error);
}

export async function loadFamilyHomeJournal(
  access: AuthenticatedAccess,
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>,
): Promise<TimelineViewModel> {
  const allCircles = !options.circleId;
  let context;
  try {
    context = await loadConnectedJournalContext(access);
  } catch (error) {
    if (shouldTrapJournalHomeInInterrupt(error)) throw error;
    return remountSoftFailTimeline(access, null, allCircles);
  }

  try {
    return await loadConnectedTimeline(access, context, {
      pages: Number(options.pages ?? "1"),
      snapshotAt: options.snapshotAt,
      allCircles,
    });
  } catch (error) {
    if (shouldTrapJournalHomeInInterrupt(error)) throw error;
    return remountSoftFailTimeline(access, context, allCircles);
  }
}
