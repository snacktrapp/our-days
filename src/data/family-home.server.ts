import "server-only";

import {
  allHomeLabel,
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
import { loadConnectedJournalContext } from "./journal-context.server";
import {
  connectedTimelineInteraction,
  loadConnectedTimeline,
  loadConnectedTimelineListing,
  type ConnectedTimelineListing,
} from "./moments.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;
type SharedFamilyTimelineList =
  Promise<ConnectedTimelineListing> | ConnectedTimelineListing;

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

function familyHomeFrame(
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
      notifications: [],
    },
    switcher,
    timelineLabel: "Chronological moments",
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
    entries: [],
  };
}

function remountSoftFailTimeline(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>> | null,
  allCircles: boolean,
): TimelineViewModel {
  return {
    ...familyHomeFrame(access, context, allCircles),
    entries: [
      {
        id: journalLoadSoftFailEntryId,
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
    refreshDegraded: true,
  };
}

export function familyHomeRefreshSoftFail(allCircles: boolean) {
  return remountSoftFailTimeline(
    {
      mode: "authenticated",
      membershipId: "",
      circleId: "",
      personId: "",
      role: "member",
    },
    null,
    allCircles,
  );
}

export function shouldTrapJournalHomeInInterrupt(error: unknown) {
  return isFatalJournalHomeError(error);
}

export async function loadFamilyHomeChrome(
  access: AuthenticatedAccess,
  options: Readonly<{
    circleId?: string;
  }>,
): Promise<
  Readonly<{
    model: TimelineViewModel;
    context: Awaited<ReturnType<typeof loadConnectedJournalContext>> | null;
  }>
> {
  const allCircles = !options.circleId;
  try {
    const context = await loadConnectedJournalContext(access, {
      includeActivity: false,
    });
    return {
      context,
      model: familyHomeFrame(access, context, allCircles),
    };
  } catch (error) {
    if (shouldTrapJournalHomeInInterrupt(error)) throw error;
    return {
      context: null,
      model: remountSoftFailTimeline(access, null, allCircles),
    };
  }
}

function familyHomeTimelineOptions(
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>,
) {
  return {
    pages: Number(options.pages ?? "1"),
    snapshotAt: options.snapshotAt,
    allCircles: !options.circleId,
  };
}

export function loadFamilyHomeTimelineList(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>>,
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>,
) {
  return loadConnectedTimelineListing(
    access,
    context,
    familyHomeTimelineOptions(options),
  );
}

export async function loadFamilyHomeOpeningTimeline(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>>,
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>,
  timelineList?: SharedFamilyTimelineList,
): Promise<
  Readonly<{
    model: TimelineViewModel;
    streamRemainder: boolean;
  }>
> {
  const first = await loadFamilyHomeFirstMoment(
    access,
    context,
    options,
    timelineList,
  );
  const hasFirstMoment = first.entries.some(
    (entry) => entry.entryType === "moment",
  );
  if (!first.refreshDegraded && hasFirstMoment) {
    return { model: first, streamRemainder: true };
  }
  if (first.refreshDegraded) {
    const recovered = await loadFamilyHomeJournal(access, options);
    return { model: recovered, streamRemainder: false };
  }
  return { model: first, streamRemainder: false };
}

export async function loadFamilyHomeFirstMoment(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>>,
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>,
  timelineList?: SharedFamilyTimelineList,
): Promise<TimelineViewModel> {
  try {
    return await loadConnectedTimeline(access, context, {
      ...familyHomeTimelineOptions(options),
      enrichLimit: 1,
      omitCompletion: true,
      omitPagination: true,
      sharedList: timelineList,
    });
  } catch (error) {
    if (shouldTrapJournalHomeInInterrupt(error)) throw error;
    return remountSoftFailTimeline(access, context, !options.circleId);
  }
}

export async function loadFamilyHomeRemainder(
  access: AuthenticatedAccess,
  context: Awaited<ReturnType<typeof loadConnectedJournalContext>>,
  options: Readonly<{
    pages?: string;
    snapshotAt?: string;
    circleId?: string;
  }>,
  timelineList?: SharedFamilyTimelineList,
): Promise<TimelineViewModel> {
  try {
    return await loadConnectedTimeline(access, context, {
      ...familyHomeTimelineOptions(options),
      enrichOffset: 1,
      sharedList: timelineList,
    });
  } catch (error) {
    if (shouldTrapJournalHomeInInterrupt(error)) throw error;
    const frame = remountSoftFailTimeline(access, context, !options.circleId);
    return {
      ...frame,
      entries: [],
      paginationError: {
        retryHref: !options.circleId
          ? "/family"
          : `/family?circle=${access.circleId}`,
        message:
          "Earlier days couldn’t be opened. The moments already here are still safe.",
        label: "Try opening earlier days again",
      },
    };
  }
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
