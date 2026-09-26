import { Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpeningJournalShell } from "@/features/shell/opening-journal-shell";
import { selectActiveGroupAction } from "@/features/groups/create-group-action";
import type { TimelineViewModel } from "@/features/timeline/timeline-view-model";
import FamilyPage, { FamilyHomeContent } from "./page";

const access = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccessUnlessRecoverable: access,
}));
vi.mock("@/data/lab-journal-delay.server", () => ({
  labJournalDataDelay: async () => undefined,
  labBlocksShellOnJournalData: () => false,
}));

describe("family journal open", () => {
  beforeEach(() => {
    access.mockReset();
  });

  it("returns the opening shell before access or timeline reads", async () => {
    const page = await FamilyPage({
      searchParams: Promise.resolve({
        moment: "quiet-ride",
        circle: "created",
      }),
    });
    expect(access).not.toHaveBeenCalled();
    expect(page).toMatchObject({
      type: Suspense,
      props: {
        fallback: expect.objectContaining({ type: OpeningJournalShell }),
      },
    });
  });

  it("keeps a signed-out redirect thrown from the streamed access check", async () => {
    access.mockRejectedValue(new Error("NEXT_REDIRECT:/sign-in"));
    await expect(
      FamilyHomeContent({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("soft-fails a recoverable access miss and keeps circle switching", async () => {
    access.mockResolvedValue(null);
    const page = await FamilyHomeContent({
      searchParams: Promise.resolve({ circle: "created" }),
    });
    expect(access).toHaveBeenCalledWith({ circleId: "created" });
    expect(page).toMatchObject({
      props: { onSelectGroup: selectActiveGroupAction, preserveChrome: true },
    });
    expect(timelineModel(page)?.entries[0]).toMatchObject({
      title: "These days couldn’t open",
    });
    expect(timelineModel(page)?.paginationError?.retryHref).toBe(
      "/family?circle=",
    );
  });
});

function timelineModel(node: ReactNode): TimelineViewModel | undefined {
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as {
    props?: { model?: TimelineViewModel; children?: ReactNode };
  };
  if (element.props?.model?.entries) return element.props.model;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = timelineModel(child);
    if (found) return found;
  }
  return undefined;
}
