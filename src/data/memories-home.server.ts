import "server-only";

import type {
  MemoriesViewModel,
  MemoryJourneyViewModel,
} from "@/features/memories/memories-view-model";
import {
  journalLoadSoftFailEntryId,
  type TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import { isFatalJournalHomeError } from "@/lib/auth/family-session-error";
import type { JournalAccess } from "@/lib/auth/journal-access";
import {
  anonymousJournalAccess,
  fallbackJournalChrome,
} from "./journal-chrome-fallback";
import { loadConnectedJournalContext } from "./journal-context.server";
import {
  loadConnectedMemories,
  loadConnectedMemoryJourney,
} from "./memories.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

type MemoryJourneyRequest =
  | Readonly<{
      mode: "year";
      year: number;
      pages?: string;
      snapshotAt?: string;
    }>
  | Readonly<{
      mode: "anniversary";
      pages?: string;
      snapshotAt?: string;
      anniversaryKey?: string;
    }>
  | Readonly<{
      mode: "milestones";
      pages?: string;
      snapshotAt?: string;
    }>;

function memoriesChrome(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>> | null,
) {
  if (context) {
    return { ...context.chrome, title: "Memories", accent: "teal" as const };
  }
  return fallbackJournalChrome(access, {
    title: "Memories",
    eyebrow: "Memories",
    accent: "teal",
  });
}

function fallbackInteraction(): TimelineViewModel["interaction"] {
  return {
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
  };
}

export function shouldTrapMemoriesInInterrupt(error: unknown) {
  return isFatalJournalHomeError(error);
}

export function memoriesRefreshSoftFail(
  access: AuthenticatedAccess = anonymousJournalAccess(),
  context: Awaited<
    ReturnType<typeof loadConnectedJournalContext>
  > | null = null,
): MemoriesViewModel {
  return {
    chrome: memoriesChrome(access, context),
    heading: "On this day",
    subheading: "This date across years",
    feature: {
      state: "empty",
      href: "/memories",
      title: "These days couldn’t open",
      description: "Try again in a moment. Nothing here was lost.",
      actionLabel: "Try opening Memories again",
    },
    years: [],
    yearsEmptyMessage:
      "Memories couldn’t open just now. Nothing here was lost.",
  };
}

function memoryJourneyCopy(options: MemoryJourneyRequest) {
  if (options.mode === "year") {
    return {
      href: `/memories/years/${options.year}`,
      eyebrow: "Browse by year",
      title: String(options.year),
      description: "Entries recorded during this year.",
    };
  }
  if (options.mode === "milestones") {
    return {
      href: "/memories/milestones",
      eyebrow: "Family milestones",
      title: "Milestones",
      description: "Milestone entries in chronological order.",
    };
  }
  return {
    href: "/memories/on-this-day",
    eyebrow: "On this day · Across the years",
    title: "On this day",
    description: "Entries recorded on this date in prior years.",
  };
}

export function memoryJourneyRefreshSoftFail(
  options: MemoryJourneyRequest,
  access: AuthenticatedAccess = anonymousJournalAccess(),
  context: Awaited<
    ReturnType<typeof loadConnectedJournalContext>
  > | null = null,
): MemoryJourneyViewModel {
  const chrome = memoriesChrome(access, context);
  const copy = memoryJourneyCopy(options);
  return {
    chrome,
    returnHref: "/memories",
    returnLabel: "All memories",
    eyebrow: copy.eyebrow,
    title: copy.title,
    description: copy.description,
    state: "moments",
    timeline: {
      chrome,
      switcher: [],
      timelineLabel: copy.title,
      interaction: fallbackInteraction(),
      entries: [
        {
          id: journalLoadSoftFailEntryId,
          entryType: "empty-state",
          title: "These days couldn’t open",
          message: "Try again in a moment. Nothing here was lost.",
        },
      ],
      paginationError: {
        retryHref: copy.href,
        message: "Memories couldn’t open just now. Nothing here was lost.",
        label: "Try opening these memories again",
      },
      refreshDegraded: true,
    },
  };
}

export async function loadMemoriesJournal(
  access: AuthenticatedAccess,
  options: Readonly<{ beforeYear?: number }> = {},
): Promise<MemoriesViewModel> {
  let context;
  try {
    context = await loadConnectedJournalContext(access);
  } catch (error) {
    if (shouldTrapMemoriesInInterrupt(error)) throw error;
    return memoriesRefreshSoftFail(access);
  }

  try {
    return await loadConnectedMemories(access, context, options);
  } catch (error) {
    if (shouldTrapMemoriesInInterrupt(error)) throw error;
    return memoriesRefreshSoftFail(access, context);
  }
}

export async function loadMemoryJourneyJournal(
  access: AuthenticatedAccess,
  options: MemoryJourneyRequest,
): Promise<MemoryJourneyViewModel> {
  let context;
  try {
    context = await loadConnectedJournalContext(access);
  } catch (error) {
    if (shouldTrapMemoriesInInterrupt(error)) throw error;
    return memoryJourneyRefreshSoftFail(options, access);
  }

  try {
    return await loadConnectedMemoryJourney(access, context, {
      ...options,
      pages: Number(options.pages ?? "1"),
    });
  } catch (error) {
    if (shouldTrapMemoriesInInterrupt(error)) throw error;
    return memoryJourneyRefreshSoftFail(options, access, context);
  }
}
