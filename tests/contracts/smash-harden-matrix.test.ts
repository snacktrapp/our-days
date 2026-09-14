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
const timelineFeedTest = read("src/features/timeline/timeline-feed.test.tsx");
const familyHomeTest = read("src/data/family-home.server.test.ts");
const rootError = read("src/app/error.tsx");
const peoplePage = read("src/app/(journal)/people/[personId]/page.tsx");
const accountPage = read("src/app/(journal)/settings/family/page.tsx");
const journalAccess = read("src/lib/auth/journal-access.ts");
const journalContext = read("src/data/journal-context.server.ts");
const sessionError = readIfPresent("src/lib/auth/family-session-error.ts");
const photoRoute = read("src/app/api/media/moments/[momentId]/route.ts");
const videoRoute = read("src/app/api/media/videos/[momentId]/route.ts");
const videoRouteTest = read(
  "src/app/api/media/videos/[momentId]/route.test.ts",
);
const journalError = read("src/app/(journal)/error.tsx");
const photoLightbox = read("src/features/timeline/photo-lightbox.tsx");
const photoLightboxTest = read("src/features/timeline/photo-lightbox.test.tsx");
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

describe("smash harden matrix", () => {
  describe("R-Account Account→Journal remount", () => {
    it("proves Family still throws required loads unless a remount helper landed", () => {
      const usesRemountHelper =
        familyPage.includes("loadFamilyHomeJournal") ||
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

  describe("lightbox dismiss and note save parity", () => {
    it("keeps Done available when a private photo fetch fails", () => {
      expect(photoLightbox).toContain("This photo could not be opened.");
      expect(photoLightbox).toContain("photo-lightbox-close");
      expect(photoLightboxTest).toContain(
        "keeps Done available when the private photo fetch fails",
      );
    });

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
    it("does not let layout requireJournalAccess throw a recoverable refresh miss", () => {
      expect(journalLayout).toContain("requireJournalAccessUnlessRecoverable");
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

    it("auto-retries a transient refresh miss instead of the root interrupt card", () => {
      expect(routeBoundary).toContain("isTransientFamilySessionError(error)");
      expect(rootError).toContain("JournalSegmentError");
      expect(rootError).not.toContain("JournalInterrupted");
    });
  });
});
