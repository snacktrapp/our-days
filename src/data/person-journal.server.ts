import "server-only";

import {
  buildJournalSwitcher,
  journalSwitcherEyebrow,
} from "@/features/shell/journal-switcher";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import {
  journalLoadSoftFailEntryId,
  type TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import { isFatalJournalHomeError } from "@/lib/auth/family-session-error";
import type { JournalAccess } from "@/lib/auth/journal-access";
import { anonymousJournalAccess } from "./journal-chrome-fallback";
import { loadConnectedJournalContext } from "./journal-context.server";
import {
  connectedTimelineInteraction,
  loadConnectedTimeline,
} from "./moments.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

function personJournalHref(personId: string) {
  return `/people/${personId}`;
}

function fallbackPersonChrome(
  access: AuthenticatedAccess,
): JournalChromeViewModel {
  return {
    accent: "slate",
    title: "Journal",
    eyebrow: "Person",
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
  personId: string,
): TimelineViewModel {
  const person = context?.people.find((candidate) => candidate.id === personId);
  const chrome =
    context && person
      ? {
          ...context.chrome,
          accent: person.accent,
          title: person.name,
          composer: context.chrome.composer.journalPeople.some(
            (option) => option.id === person.id,
          )
            ? {
                ...context.chrome.composer,
                defaultJournalPersonId: person.id,
              }
            : context.chrome.composer,
        }
      : (context?.chrome ?? fallbackPersonChrome(access));
  const switcher = buildJournalSwitcher({
    groups: context?.groups,
    groupLabel: context?.circleName,
    people: context?.people ?? [],
    viewerPersonId: access.personId,
    viewerPersonIds: context?.viewerPersonIds,
    currentHref: personJournalHref(personId),
    activeGroupId: access.circleId,
  });
  return {
    chrome: {
      ...chrome,
      eyebrow: journalSwitcherEyebrow(switcher),
    },
    switcher,
    timelineLabel: person
      ? `Chronological moments for ${person.name}`
      : "Chronological moments",
    personalIntro: person
      ? {
          initial: person.initial,
          accent: person.accent,
          title: `${person.name}’s journal`,
          summary: "Chronological entries",
        }
      : undefined,
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
        id: journalLoadSoftFailEntryId,
        entryType: "empty-state",
        title: "These days couldn’t open",
        message: "Try again in a moment. Nothing here was lost.",
      },
    ],
    paginationError: {
      retryHref: personJournalHref(personId),
      message:
        "The journal couldn’t open these days just now. Nothing here was lost.",
      label: "Try opening the journal again",
    },
    refreshDegraded: true,
  };
}

export function shouldTrapPersonJournalInInterrupt(error: unknown) {
  return isFatalJournalHomeError(error);
}

export function personJournalRefreshSoftFail(personId: string) {
  return remountSoftFailTimeline(anonymousJournalAccess(), null, personId);
}

export async function loadPersonJournal(
  access: AuthenticatedAccess,
  options: Readonly<{
    personId: string;
    pages?: string;
    snapshotAt?: string;
  }>,
): Promise<TimelineViewModel | null> {
  let context;
  try {
    context = await loadConnectedJournalContext(access, {
      includeActivity: false,
    });
  } catch (error) {
    if (shouldTrapPersonJournalInInterrupt(error)) throw error;
    return remountSoftFailTimeline(access, null, options.personId);
  }

  if (!context.people.some((person) => person.id === options.personId)) {
    return null;
  }

  try {
    return await loadConnectedTimeline(access, context, {
      journalPersonId: options.personId,
      pages: Number(options.pages ?? "1"),
      snapshotAt: options.snapshotAt,
    });
  } catch (error) {
    if (shouldTrapPersonJournalInInterrupt(error)) throw error;
    return remountSoftFailTimeline(access, context, options.personId);
  }
}
