import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedSaveAcknowledgment } from "./feed-save-acknowledgment";
import {
  addOptimisticMediaUpload,
  clearOptimisticMediaUploads,
  optimisticMediaUploadSnapshot,
} from "@/features/composer/optimistic-media-upload";
import {
  startOptimisticMomentSave,
  optimisticMomentSaveSnapshot,
  clearOptimisticMomentSaves,
  retryOptimisticMomentSave,
} from "@/features/composer/optimistic-moment-save";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  clearOptimisticMomentSaves();
  clearOptimisticMediaUploads();
  vi.restoreAllMocks();
});

it("reveals the completed post once, below the header, and not again on refresh", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const view = render(
    <>
      <header className="topbar" />
      <article id="moment-backdated-photo" />
      <FeedSaveAcknowledgment
        momentIds={["backdated-photo"]}
        mediaCounts={{ "backdated-photo": 1 }}
      />
    </>,
  );
  vi.spyOn(
    document.querySelector(".topbar")!,
    "getBoundingClientRect",
  ).mockReturnValue({ bottom: 100 } as DOMRect);
  vi.spyOn(
    document.getElementById("moment-backdated-photo")!,
    "getBoundingClientRect",
  ).mockReturnValue({ top: 900 } as DOMRect);
  act(() =>
    addOptimisticMediaUpload({
      id: "new-upload",
      circleId: "family",
      kind: "photo",
      body: "",
      occurredOn: "2020-01-01",
      occurredTime: "",
      journalPersonId: "alex",
      journalPersonName: "Alex",
      journalPersonInitial: "A",
      journalPersonAccent: "teal",
      previewUrl: "",
      momentId: "backdated-photo",
      totalFiles: 1,
      completedFiles: 1,
      stage: { state: "published" },
    }),
  );
  act(() => frames.splice(0).forEach((callback) => callback(0)));
  expect(window.scrollTo).toHaveBeenCalledWith({
    top: 784,
    behavior: "instant",
  });
  expect(optimisticMediaUploadSnapshot()).toHaveLength(0);
  view.rerender(
    <FeedSaveAcknowledgment
      momentIds={["backdated-photo"]}
      mediaCounts={{ "backdated-photo": 1 }}
    />,
  );
  expect(window.scrollTo).toHaveBeenCalledTimes(1);
});

it("waits for the complete album, not just its already-visible cover", () => {
  addOptimisticMediaUpload({
    id: "album",
    circleId: "family",
    kind: "photo",
    body: "",
    occurredOn: "2026-09-20",
    occurredTime: "",
    journalPersonId: "alex",
    journalPersonName: "Alex",
    journalPersonInitial: "A",
    journalPersonAccent: "teal",
    previewUrl: "",
    momentId: "album-moment",
    totalFiles: 6,
    completedFiles: 6,
    stage: { state: "published" },
  });
  const view = render(
    <FeedSaveAcknowledgment
      momentIds={["album-moment"]}
      mediaCounts={{ "album-moment": 1 }}
    />,
  );
  expect(optimisticMediaUploadSnapshot()).toHaveLength(1);
  view.rerender(
    <FeedSaveAcknowledgment
      momentIds={["album-moment"]}
      mediaCounts={{ "album-moment": 6 }}
    />,
  );
  expect(optimisticMediaUploadSnapshot()).toHaveLength(0);
});

it("keeps a successful write until its entry reaches the feed, without retrying the write", async () => {
  const save = vi.fn(async () => ({
    ok: true,
    message: "Saved",
    momentId: "new-note",
  }));
  const refresh = vi.fn(() => {
    throw new Error("refresh unavailable");
  });
  const view = render(<FeedSaveAcknowledgment momentIds={["older-note"]} />);
  let id = "";
  act(() => {
    id = startOptimisticMomentSave({
      circleId: "family",
      mode: "thought",
      title: "",
      body: "New note",
      placeName: "",
      taggedPeopleLabel: "",
      occurredOn: "2026-09-20",
      occurredTime: "",
      person: { name: "Alex", initial: "A", accent: "teal" },
      save,
      onPublished: refresh,
    });
  });
  await waitFor(() =>
    expect(optimisticMomentSaveSnapshot()[0]?.stage.state).toBe("published"),
  );
  act(() => retryOptimisticMomentSave(id));
  expect(save).toHaveBeenCalledTimes(1);
  view.rerender(
    <FeedSaveAcknowledgment momentIds={["older-note", "new-note"]} />,
  );
  expect(optimisticMomentSaveSnapshot()).toEqual([]);
});
