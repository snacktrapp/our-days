import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  clearOptimisticMomentSaves();
  clearOptimisticMediaUploads();
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
