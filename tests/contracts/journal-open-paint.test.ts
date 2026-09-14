import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

const journalLayout = read("src/app/(journal)/layout.tsx");
const journalLoading = read("src/app/(journal)/loading.tsx");
const familyPage = read("src/app/(journal)/family/page.tsx");
const familyHome = read("src/data/family-home.server.ts");
const journalContext = read("src/data/journal-context.server.ts");
const openingShell = read("src/features/shell/opening-journal-shell.tsx");

describe("journal open paint", () => {
  it("keeps the journal layout shell-first without an eager access throw path", () => {
    expect(journalLayout).toContain("JournalRouteBoundary");
    expect(journalLayout).not.toContain(
      "requireJournalAccessUnlessRecoverable",
    );
    expect(journalLayout).not.toContain("JournalAccessGate");
    expect(journalLayout).not.toMatch(
      /export default async function JournalLayout/,
    );
    expect(journalLoading).toContain("OpeningJournalShell");
  });

  it("paints All-circles chrome without a first-page moment payload", () => {
    expect(openingShell).toContain("allHomeLabel");
    expect(openingShell).toContain('aria-label="Primary navigation"');
    expect(openingShell).toContain("route-pending-skeleton");
    expect(openingShell).not.toContain("JournalChrome");
    expect(openingShell).not.toContain("PhotoStatusShelf");
    expect(openingShell).not.toContain("loadConnectedTimeline");
  });

  it("defers Activity and streams the first moment ahead of the rest of the page", () => {
    expect(familyPage).toContain("loadFamilyHomeChrome");
    expect(familyPage).toMatch(
      /loadFamilyHomeFirstMoment|loadFamilyHomeOpeningTimeline/,
    );
    expect(familyPage).toContain("loadFamilyHomeRemainder");
    expect(familyPage).toContain("loadJournalActivityNotifications");
    expect(familyPage).toContain("OpeningJournalShell");
    expect(familyPage).toContain("familyHomeRefreshSoftFail");
    expect(familyHome).toContain("includeActivity: false");
    expect(familyHome).toContain("enrichLimit: 1");
    expect(journalContext).toContain("includeActivity");
    expect(journalContext).toContain("loadJournalActivityNotifications");
  });
});
