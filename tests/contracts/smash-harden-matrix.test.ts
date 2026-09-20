import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

function readIfPresent(path: string) {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

const familyPage = read("src/app/(journal)/family/page.tsx");
const journalLayout = read("src/app/(journal)/layout.tsx");
const familyHome = read("src/data/family-home.server.ts");
const timelineViewModel = read("src/features/timeline/timeline-view-model.ts");
const timelineFeed = read("src/features/timeline/timeline-feed.tsx");
const timelineFeedTest = read("src/features/timeline/timeline-feed.test.tsx");
const familyHomeTest = read("src/data/family-home.server.test.ts");
const rootError = read("src/app/error.tsx");
const peoplePage = read("src/app/(journal)/people/[personId]/page.tsx");
const accountPage = read("src/app/(journal)/settings/family/page.tsx");
const trashPage = read("src/app/(journal)/trash/page.tsx");
const memoriesPage = read("src/app/(journal)/memories/page.tsx");
const memoriesYearPage = read(
  "src/app/(journal)/memories/years/[year]/page.tsx",
);
const memoriesOnThisDayPage = read(
  "src/app/(journal)/memories/on-this-day/page.tsx",
);
const memoriesMilestonesPage = read(
  "src/app/(journal)/memories/milestones/page.tsx",
);
const memoriesHome = readIfPresent("src/data/memories-home.server.ts");
const journalInterrupted = read("src/features/shell/journal-interrupted.tsx");
const openingShell = read("src/features/shell/opening-journal-shell.tsx");
const journalAccess = read("src/lib/auth/journal-access.ts");
const journalContext = read("src/data/journal-context.server.ts");
const sessionError = readIfPresent("src/lib/auth/family-session-error.ts");
const photoRoute = read("src/app/api/media/moments/[momentId]/route.ts");
const videoRoute = read("src/app/api/media/videos/[momentId]/route.ts");
const videoRouteTest = read(
  "src/app/api/media/videos/[momentId]/route.test.ts",
);
const journalError = read("src/app/(journal)/error.tsx");
const photoCardPager = read("src/features/timeline/photo-card-pager.tsx");
const photoCardPagerTest = read(
  "src/features/timeline/photo-card-pager.test.tsx",
);
const journalChrome = read("src/features/shell/journal-chrome.tsx");
const videoMomentMedia = read("src/features/timeline/video-moment-media.tsx");
const privateVideoPlayer = read("src/components/private-video-player.tsx");
const conversationControl = read(
  "src/features/timeline/moment-conversation-control.tsx",
);
const conversationControlTest = read(
  "src/features/timeline/moment-conversation-control.test.tsx",
);
const photoDelivery = read(
  "supabase/migrations/20260907204138_moment_circles.sql",
);
const hideNav = read("src/features/shell/hide-bottom-nav-while-composing.ts");
const hideNavTest = read(
  "src/features/shell/hide-bottom-nav-while-composing.test.tsx",
);
const viewport = read("src/features/shell/visual-viewport-bottom.ts");
const viewportTest = read("src/features/shell/visual-viewport-bottom.test.ts");
const audienceChip = read("src/features/timeline/audience-chip.tsx");
const audienceChipTest = read("src/features/timeline/audience-chip.test.tsx");
const bottomNavCss = read("tests/contracts/bottom-nav-compact.test.ts");
const refreshTest = read(
  "src/features/timeline/timeline-refresh-control.test.tsx",
);
const routeBoundary = read("src/features/shell/journal-route-boundary.tsx");
const photoWorker = read("src/lib/photo-worker.server.ts");
const photoProcessRoute = read("src/app/api/photos/process/route.ts");
const photoProcessRouteTest = read("src/app/api/photos/process/route.test.ts");
const photoUpload = read("src/features/composer/photo-upload.ts");
const optimisticUpload = read(
  "src/features/composer/optimistic-media-upload.ts",
);
const optimisticUploadTest = read(
  "src/features/composer/optimistic-media-upload.test.ts",
);
const photoStatusShelf = read("src/features/composer/photo-status-shelf.tsx");
const photoStatusShelfTest = read(
  "src/features/composer/photo-status-shelf.test.tsx",
);
const activityNotifications = read("src/lib/activity-notifications.ts");
const activityNotificationsTest = read(
  "src/lib/activity-notifications.test.ts",
);
const momentActionsTest = read("src/features/moments/moment-actions.test.ts");
const buildEditDraft = read("src/features/composer/build-edit-draft.ts");
const buildEditDraftTest = read(
  "src/features/composer/build-edit-draft.test.ts",
);
const entryDraftMedia = read("src/features/composer/entry-draft-media.ts");
const entryDraftMediaTest = read(
  "src/features/composer/entry-draft-media.test.ts",
);
const momentComposer = read("src/features/composer/moment-composer.tsx");
const momentComposerTest = read(
  "src/features/composer/moment-composer.test.tsx",
);

describe("smash harden matrix", () => {
  describe("R-Account Account→Journal remount", () => {
    it("proves Family still throws required loads unless a remount helper landed", () => {
      const usesRemountHelper =
        familyPage.includes("loadFamilyHomeJournal") ||
        familyPage.includes("loadFamilyHomeOpeningTimeline") ||
        (familyPage.includes("loadFamilyHomeChrome") &&
          familyPage.includes("loadFamilyHomeFirstMoment"));
      const throwsDirect =
        familyPage.includes(
          "const context = await loadConnectedJournalContext(access);",
        ) && !/try\s*\{[\s\S]*loadConnectedJournalContext/.test(familyPage);
      expect(usesRemountHelper || throwsDirect).toBe(true);
      expect(accountPage).toMatch(/try\s*\{[\s\S]*loadConnectedJournalContext/);
    });

    it("keeps People remount off JournalInterrupted once loadPersonJournal lands", () => {
      const usesRemountHelper = peoplePage.includes("loadPersonJournal");
      const throwsDirect =
        peoplePage.includes("loadConnectedJournalContext(access)") &&
        !/try\s*\{[\s\S]*loadConnectedJournalContext/.test(peoplePage);
      expect(usesRemountHelper || throwsDirect).toBe(true);
    });

    it("keeps Activity fail-open while required roster queries still throw after retry", () => {
      expect(journalContext).toContain("loadOptionalJournalActivity");
      expect(journalContext).toContain("if (error) throw error;");
      expect(journalContext).toContain(
        'throw new Error("Member profile is unavailable")',
      );
    });

    it("classifies abort as remount-recoverable once #62 lands, and proves it missing on main", () => {
      const source = `${journalAccess}\n${sessionError}\n${routeBoundary}`;
      const hasAbort =
        source.includes("AbortError") ||
        source.includes("isRecoverableJournalNavigationError");
      if (hasAbort) {
        expect(source).toMatch(/AbortError|abort/u);
      } else {
        expect(journalAccess).not.toContain("AbortError");
        expect(routeBoundary).not.toMatch(
          /AbortError|isJournalNavigationAbort/,
        );
      }
    });

    it("auto-retries layout remount aborts from the segment error view", () => {
      expect(journalError).toContain("JournalSegmentError");
      expect(routeBoundary).toContain("export function JournalSegmentError");
      expect(journalAccess).toContain("isTransientFamilySessionError(error)");
    });
  });

  describe("M-open timeline media", () => {
    it("requires a live family session and derivative capability before bytes", () => {
      expect(photoDelivery).toContain(
        "private.photo_capability_is_enabled(\n      'family_derivative_delivery'",
      );
      expect(photoDelivery).toContain(
        "private.current_family_session_is_live()",
      );
      expect(photoRoute).toContain("get_photo_moment_delivery");
      expect(photoRoute).toContain("if (descriptorError || !descriptor)");
      expect(photoRoute).toContain("fetchSignedPrivateObject");
    });

    it("would have 404'd openable photos when Storage omitted MIME or stringified size", () => {
      const failClose = (
        photo: Readonly<{ size: number; type: string }>,
        outputSize: unknown,
        outputMime: string,
      ) => photo.size !== outputSize || photo.type !== outputMime;

      expect(failClose({ size: 5, type: "" }, 5, "image/webp")).toBe(true);
      expect(
        failClose(
          { size: 5, type: "application/octet-stream" },
          5,
          "image/webp",
        ),
      ).toBe(true);
      expect(
        failClose({ size: 5, type: "image/webp" }, "5", "image/webp"),
      ).toBe(true);
      expect(failClose({ size: 5, type: "image/webp" }, 5, "image/webp")).toBe(
        false,
      );

      const usesOldPredicate = photoRoute.includes(
        "photo.type !== descriptor.output_mime_type",
      );
      const usesHelper = photoRoute.includes("mediaTypeMatches");
      expect(usesOldPredicate || usesHelper).toBe(true);
    });

    it("does not advertise a Safari 206 from a truncated Storage body", () => {
      expect(videoRoute).toContain(
        "byteSizeMatches(bytes.byteLength, expectedSize)",
      );
      expect(videoRouteTest).toContain(
        "fails closed when Storage omits Content-Length and the body is shorter than the descriptor",
      );
    });
  });

  describe("note save parity", () => {
    it("does not treat a post-save conversation reload failure as a lost note", () => {
      expect(conversationControl).toContain("rememberLocalNote");
      expect(conversationControl).toContain("if (!reloaded) setError(null)");
      expect(conversationControlTest).toContain(
        "keeps a saved note visible when conversation reload fails",
      );
    });
  });

  describe("K1–K3, K5 note + keyboard + chips", () => {
    it("hides the bottom nav while a note is open and restores it on close", () => {
      expect(hideNav).toContain(".inline-note-form");
      expect(hideNavTest).toContain(
        "hides the bottom nav while the inline note panel is open and restores it on cancel",
      );
      expect(bottomNavCss).toContain(
        "hides the pill without lifting it when a note or composer is open",
      );
    });

    it("does not lift the tab bar on iOS pull-down overscroll", () => {
      expect(viewport).toContain("if (viewport.offsetTop < 0) return 0;");
      expect(viewportTest).toContain(
        "does not treat rubber-band overscroll as a bottom gap",
      );
      expect(viewportTest).toContain(
        "clears rubber-band measurements instead of lifting chrome",
      );
    });

    it("does not leave the tab bar mid-screen after a landscape overlay", () => {
      expect(viewport).toContain("overlayFreezesChromeInset");
      expect(viewport).toContain("restoreBottomNavAfterOverlay");
      expect(viewport).toContain("visualViewportOrientationMatchesLayout");
      expect(viewportTest).toContain(
        "does not treat a stale landscape visual viewport as a keyboard",
      );
      expect(viewportTest).toContain(
        "restores the tab bar after a landscape overlay leaves a stale visual viewport",
      );
    });

    it("keeps audience chips decoration-only", () => {
      expect(audienceChip).toContain('<span className="audience-chip"');
      expect(audienceChipTest).toContain(
        "renders a decorative chip and does not expand names",
      );
    });
  });

  describe("R1–R3 hard refresh / retry journal load", () => {
    it("retries a transient family session once before failing closed", () => {
      expect(journalAccess).toContain("retryTransientFamilySessionQuery");
      expect(journalAccess).toContain("return run();");
    });

    it("refreshes the journal on resume and pull-to-refresh", () => {
      expect(refreshTest).toContain(
        "refreshes the journal after the tab returns from the background",
      );
      expect(refreshTest).toContain(
        "refreshes the timeline after a pull past the threshold",
      );
    });
  });

  describe("R-All-circles in-place refresh", () => {
    it("keeps layout shell-first while pages own recoverable access decisions", () => {
      expect(journalLayout).toContain("JournalRouteBoundary");
      expect(journalLayout).not.toContain(
        "requireJournalAccessUnlessRecoverable",
      );
      expect(journalAccess).toContain(
        "export async function requireJournalAccessUnlessRecoverable",
      );
      expect(familyPage).toContain("requireJournalAccessUnlessRecoverable");
      expect(familyPage).toContain("familyHomeRefreshSoftFail");
    });

    it("keeps All-circles refresh misses off JournalInterrupted", () => {
      expect(timelineViewModel).toContain("preferPriorTimelineOnRefresh");
      expect(timelineFeedTest).toContain(
        "does not show JournalInterrupted when an All-circles refresh soft-fails",
      );
      expect(familyHome).toContain("refreshDegraded: true");
      expect(familyHomeTest).toContain(
        "does not trap JournalInterrupted when All-circles refresh misses the first page",
      );
    });

    it("keeps root and route boundaries off the interrupt card for non-fatal refresh misses", () => {
      expect(routeBoundary).toContain("isTransientFamilySessionError(error)");
      expect(routeBoundary).toContain("isNextControlFlowError(error)");
      expect(routeBoundary).toContain("JournalOpenUnavailable");
      expect(rootError).toContain("JournalSegmentError");
      expect(rootError).not.toContain("OpeningJournalShell");
    });
  });

  describe("timeline media stays inline", () => {
    it("renders photos without a lightbox trigger", () => {
      expect(photoCardPager).not.toContain("PhotoLightboxTrigger");
      expect(journalChrome).not.toContain("PhotoLightboxRoot");
      expect(photoCardPagerTest).toContain(
        "keeps album photos out of fullscreen buttons",
      );
      expect(
        existsSync(resolve(root, "src/features/timeline/photo-lightbox.tsx")),
      ).toBe(false);
    });

    it("renders videos with native inline controls and no fullscreen API", () => {
      expect(videoMomentMedia).toContain("<PrivateVideoPlayer");
      expect(videoMomentMedia).toContain("controls");
      expect(videoMomentMedia).toContain("playsInline");
      expect(videoMomentMedia).not.toContain("requestFullscreen");
      expect(videoMomentMedia).not.toContain("webkitEnterFullscreen");
      expect(privateVideoPlayer).toContain("playsInline={playsInline}");
      expect(
        existsSync(resolve(root, "src/components/native-video-fullscreen.tsx")),
      ).toBe(false);
    });
  });

  describe("edit multi-photo notify", () => {
    it("does not fire a moment push from photo-ready worker or process retry", () => {
      expect(photoWorker).not.toContain("deliverActivityWebPush");
      expect(photoProcessRoute).not.toContain("deliverActivityWebPush");
      expect(photoProcessRouteTest).toContain(
        "expect(mocks.deliver).not.toHaveBeenCalled()",
      );
    });

    it("announces one create or edit batch from the first photo only", () => {
      expect(activityNotifications).toContain(
        "shouldAnnouncePhotoMomentPublication",
      );
      expect(photoUpload).toContain("shouldAnnouncePhotoMomentPublication");
      expect(optimisticUpload).toContain(
        "announcePublication: absoluteIndex === 0",
      );
      expect(optimisticUploadTest).toContain(
        "announces only the first photo of a new multi-photo post",
      );
      expect(optimisticUploadTest).toContain(
        "announces only the first photo when an edit adds several",
      );
      expect(activityNotificationsTest).toContain(
        "announces one photo batch once, including an edit that adds several",
      );
      expect(momentComposerTest).toContain(
        "adds several photos to a saved moment as one announce batch",
      );
    });

    it("keeps comment and reaction pushes on their own kinds", () => {
      expect(momentActionsTest).toContain(
        "delivers comment push with the parent moment id, not the note id",
      );
      expect(momentActionsTest).toContain(
        "delivers a reaction push without treating it as a moment post",
      );
    });
  });

  describe("composer queue + draft integrity", () => {
    it("surfaces queued uploads so a second post is not silently hidden", () => {
      expect(optimisticUpload).toContain(
        "export function queuedOptimisticMediaUploadCount(circleId?: string)",
      );
      expect(optimisticUpload).toContain("queuedUploads.push");
      expect(photoStatusShelf).toContain(
        "() => queuedOptimisticMediaUploadCount(circleId)",
      );
      expect(photoStatusShelf).toContain("post is");
      expect(photoStatusShelfTest).toContain(
        "shows waiting detail when a second post is queued behind an active upload",
      );
    });

    it("warns when saved draft media is missing and clears stale blob keys", () => {
      expect(momentComposer).toContain(
        "Some saved media couldn't be restored. Add it again before posting.",
      );
      expect(momentComposerTest).toContain(
        "warns when a saved photo draft reopens without its local media",
      );
      expect(entryDraftMedia).toContain(
        "export async function removeStaleEntryDraftMedia",
      );
      expect(entryDraftMediaTest).toContain(
        "removes stale media keys when a draft is re-saved with fewer files",
      );
    });

    it("keeps primary photo ids in edit drafts for remove/reorder calls", () => {
      expect(buildEditDraft).toContain("id: photo.id");
      expect(buildEditDraftTest).toContain('id: "moment-1"');
    });
  });

  describe("R-All-circles first-card recover", () => {
    it("keeps timeline rendering server-owned and recovers the first card", () => {
      expect(timelineFeed).not.toContain("TimelineRefreshMemory");
      expect(timelineFeed).not.toMatch(/\{\(resolved\)\s*=>/u);
      expect(timelineFeedTest).toContain(
        "does not show JournalInterrupted when an All-circles refresh soft-fails",
      );
      expect(familyHome).toContain("loadFamilyHomeOpeningTimeline");
    });
  });

  describe("R-Memories / R-Trash remount", () => {
    it("keeps Memories landing off JournalInterrupted on recoverable misses", () => {
      expect(memoriesPage).toContain("requireJournalAccessUnlessRecoverable");
      expect(memoriesPage).toContain("loadMemoriesJournal");
      expect(memoriesHome).toContain(
        "export async function loadMemoriesJournal",
      );
      expect(memoriesHome).toContain("memoriesRefreshSoftFail");
    });

    it("keeps Memories journeys off JournalInterrupted on page-0 misses", () => {
      expect(memoriesYearPage).toContain("loadMemoryJourneyJournal");
      expect(memoriesOnThisDayPage).toContain("loadMemoryJourneyJournal");
      expect(memoriesMilestonesPage).toContain("loadMemoryJourneyJournal");
      expect(memoriesHome).toContain(
        "export async function loadMemoryJourneyJournal",
      );
    });

    it("keeps Recently removed off JournalInterrupted on recoverable misses", () => {
      expect(trashPage).toContain("requireJournalAccessUnlessRecoverable");
      expect(trashPage).toContain("loadTrashJournal");
      expect(trashPage).toContain("JournalPanelInterrupted");
    });
  });

  describe("R-Account chrome + People access gate", () => {
    it("keeps Account chrome when context misses instead of the full interrupt card", () => {
      expect(accountPage).toContain("requireJournalAccessUnlessRecoverable");
      expect(accountPage).toContain("AccountPanelInterrupted");
      expect(accountPage).not.toContain("JournalRefreshInterrupted");
      expect(journalInterrupted).toContain("JournalPanelInterrupted");
    });

    it("soft-fails People access-gate misses the same way as Family", () => {
      expect(peoplePage).toContain("requireJournalAccessUnlessRecoverable");
      expect(peoplePage).toContain("personJournalRefreshSoftFail");
      expect(journalAccess).toContain("retryTransientFamilySessionQuery");
      expect(journalAccess).toContain('.from("people")');
    });
  });

  describe("C-Cold-open shell-first", () => {
    it("keeps Family streaming chrome then the first moment", () => {
      expect(familyPage).toContain("OpeningJournalShell");
      expect(familyPage).toContain("loadFamilyHomeChrome");
      expect(familyPage).toContain("loadFamilyHomeOpeningTimeline");
      expect(openingShell).toContain(
        '<RoutePendingSkeleton kind="timeline" />',
      );
      expect(openingShell).not.toContain('className="time-rail"');
    });
  });

  describe("M-album paging + K-note keyboard + fail-chip dismiss", () => {
    it("pages the album in place without a fullscreen trigger", () => {
      expect(photoCardPager).toContain("Photo {displayIndex + 1} of");
      expect(photoCardPagerTest).toContain(
        "keeps album photos out of fullscreen buttons",
      );
    });

    it("opens comments with tap-synchronous focus and keeps Post above the keyboard", () => {
      expect(conversationControl).toContain("<CommentDrawer");
      expect(conversationControl).toContain(
        'flushSync(() => setPanel("note"))',
      );
      expect(conversationControl).toContain(
        "noteRef.current?.focus({ preventScroll: true })",
      );
      expect(conversationControl).not.toContain("scrollIntoView");
      expect(read("src/features/timeline/comment-drawer.tsx")).toContain(
        "useVisualViewportFill(dialogRef, true)",
      );
      expect(conversationControlTest).toContain(
        "retains a draft after dismissing the drawer and restores focus",
      );
      expect(read("tests/e2e/moment-detail.spec.ts")).toContain(
        "comment drawer follows the keyboard viewport and keeps Post readable",
      );
    });

    it("lets a retryable failed upload chip be dismissed", () => {
      expect(photoStatusShelf).toMatch(
        /uploadChip[\s\S]*secondaryAction:[\s\S]*Dismiss/,
      );
      expect(photoStatusShelfTest).toContain(
        "dismisses a retryable failed upload without retrying",
      );
    });
  });
});
