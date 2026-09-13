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
const peoplePage = read("src/app/(journal)/people/[personId]/page.tsx");
const accountPage = read("src/app/(journal)/settings/family/page.tsx");
const journalAccess = read("src/lib/auth/journal-access.ts");
const journalContext = read("src/data/journal-context.server.ts");
const sessionError = readIfPresent("src/lib/auth/family-session-error.ts");
const photoRoute = read("src/app/api/media/moments/[momentId]/route.ts");
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
      const usesRemountHelper = familyPage.includes("loadFamilyHomeJournal");
      const throwsDirect =
        familyPage.includes(
          "const context = await loadConnectedJournalContext(access);",
        ) && !/try\s*\{[\s\S]*loadConnectedJournalContext/.test(familyPage);
      expect(usesRemountHelper || throwsDirect).toBe(true);
      expect(accountPage).toMatch(/try\s*\{[\s\S]*loadConnectedJournalContext/);
    });

    it("leaves People journal remount on the same uncaught load path (gap after #62)", () => {
      expect(peoplePage).toContain("loadConnectedJournalContext(access)");
      expect(peoplePage).toContain("loadConnectedTimeline(access, context");
      expect(peoplePage).not.toMatch(
        /try\s*\{[\s\S]*loadConnectedJournalContext/,
      );
      expect(peoplePage).not.toContain("loadFamilyHomeJournal");
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
});
