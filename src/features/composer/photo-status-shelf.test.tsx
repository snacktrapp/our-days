import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    getSession: vi.fn(),
    listForScope: vi.fn(),
    refresh,
    remove: vi.fn(),
    router: { refresh },
    rpc: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createOurDaysBrowserClient: () => ({
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
  }),
}));
vi.mock("./photo-upload-resume-store", () => ({
  photoUploadResumeStore: {
    listForScope: mocks.listForScope,
    remove: mocks.remove,
  },
}));

import { PhotoStatusShelf } from "./photo-status-shelf";
import {
  addOptimisticMediaUpload,
  clearOptimisticMediaUploads,
  updateOptimisticMediaUpload,
} from "./optimistic-media-upload";
import {
  clearOptimisticMomentSaves,
  startOptimisticMomentSave,
} from "./optimistic-moment-save";

const circleId = "20000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";
const intakeId = "d6000000-0000-4000-8000-000000000001";
const serverRow = {
  can_cancel: true,
  cleanup_state: "not_requested",
  intake_id: intakeId,
  journal_person_id: "30000000-0000-4000-8000-000000000001",
  journal_person_name: "A Organizer One",
  moment_id: "d6000000-0000-4000-8000-000000000002",
  occurred_on: "2026-08-21",
  requested_at: "2026-08-31T12:00:00Z",
  status: "uploading",
};
const localRecord = {
  id: "resume-1",
  accountId,
  acknowledged: false,
  circleId,
  draftHash: "a".repeat(64),
  fileSha256: "b".repeat(64),
  fileSize: 1_024,
  intakeId,
  mimeType: "image/jpeg",
  momentId: serverRow.moment_id,
  requestKey: "request-1",
  uploadRequestKey: "upload-request-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  clearOptimisticMediaUploads();
  clearOptimisticMomentSaves();
  window.sessionStorage.clear();
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: accountId } } },
    error: null,
  });
  mocks.listForScope.mockResolvedValue([]);
  mocks.remove.mockResolvedValue(undefined);
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "cancel_photo_intake") {
      return {
        data: [
          {
            cleanup_state: "queued",
            intake_id: intakeId,
            state: "invalidated",
          },
        ],
        error: null,
      };
    }
    return { data: [serverRow], error: null };
  });
});

afterEach(() => {
  clearOptimisticMediaUploads();
  clearOptimisticMomentSaves();
  vi.unstubAllGlobals();
});

describe("PhotoStatusShelf", () => {
  it("shows a compact chip while a written save continues", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    startOptimisticMomentSave({
      circleId,
      mode: "thought",
      title: "",
      body: "The exact note is already on the timeline.",
      placeName: "",
      taggedPeopleLabel: "Molly",
      occurredOn: "2026-09-01",
      occurredTime: "09:29",
      person: { name: "Brian", initial: "B", accent: "teal" },
      save: () => new Promise(() => undefined),
      onPublished: vi.fn(),
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Adding note…")).toBeVisible();
    expect(
      screen.queryByText(/The exact note is already on the timeline\./u),
    ).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows compact upload progress without a photo preview card", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "local-upload-1",
      circleId,
      kind: "photo",
      body: "The exact note entered before Save.",
      occurredOn: "2026-09-01",
      occurredTime: "14:58",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:private-preview",
      totalFiles: 4,
      completedFiles: 1,
      stage: { state: "uploading", progress: 0.4 },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Uploading 2 of 4…")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveValue(0.4);
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.queryByText("The exact note entered before Save."),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Media being added" }),
    ).toBeNull();
  });

  it("keeps a backdated upload as the same compact chip", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "backdated-upload",
      circleId,
      kind: "photo",
      body: "An older memory",
      occurredOn: "2021-04-03",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:private-backdated-preview",
      stage: { state: "preparing" },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Uploading…")).toBeVisible();
    expect(screen.queryByText(/Will appear on Apr 3, 2021/u)).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Media being added" }),
    ).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("refreshes the timeline when the server accepts a moment, not a ghost card", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "accepted-upload",
      circleId,
      kind: "photo",
      body: "Will land on its date.",
      occurredOn: "2021-04-03",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:private-accepted",
      momentId: "d6000000-0000-4000-8000-000000000099",
      stage: { state: "uploading", progress: 0.5 },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("Uploading…")).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Will land on its date.")).toBeNull();
  });

  it("offers Retry on the same chip after a failed upload", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "failed-upload",
      circleId,
      kind: "photo",
      body: "Should not become a feed card.",
      occurredOn: "2026-09-01",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:failed",
      retryable: true,
      stage: { state: "failed", message: "That photo could not be uploaded." },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Upload failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Should not become a feed card.")).toBeNull();
  });

  it("shows one chip when two uploads are in flight", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "older-upload",
      circleId,
      kind: "photo",
      body: "Older",
      occurredOn: "2026-09-01",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:older",
      stage: { state: "processing" },
    });
    addOptimisticMediaUpload({
      id: "newer-upload",
      circleId,
      kind: "photo",
      body: "Newer",
      occurredOn: "2026-09-01",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:newer",
      totalFiles: 3,
      completedFiles: 0,
      stage: { state: "uploading", progress: 0.2 },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Uploading 1 of 3…")).toBeVisible();
    expect(screen.queryByText("Adding your photo…")).toBeNull();
    expect(
      screen.getAllByRole("region", { name: "Private photo status" }),
    ).toHaveLength(1);
  });

  it("keeps Uploading X of Y through every in-batch stage", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "batch-upload",
      circleId,
      kind: "photo",
      body: "Batch",
      occurredOn: "2026-09-01",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:batch",
      totalFiles: 4,
      completedFiles: 1,
      stage: { state: "uploading", progress: 0.4 },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Uploading 2 of 4…")).toBeVisible();
    expect(
      document.querySelector(".photo-status-chip")?.childElementCount,
    ).toBe(2);
    expect(screen.getByRole("progressbar")).toHaveValue(0.4);

    act(() => {
      updateOptimisticMediaUpload("batch-upload", {
        completedFiles: 1,
        stage: { state: "finishing" },
      });
    });
    expect(screen.getByText("Uploading 2 of 4…")).toBeVisible();
    expect(screen.queryByText(/Adding (your )?photo/u)).toBeNull();
    expect(
      document.querySelector(".photo-status-chip")?.childElementCount,
    ).toBe(2);

    act(() => {
      updateOptimisticMediaUpload("batch-upload", {
        completedFiles: 2,
        stage: { state: "processing" },
      });
    });
    expect(screen.getByText("Uploading 3 of 4…")).toBeVisible();
    expect(screen.queryByText("Adding your photo…")).toBeNull();
    expect(screen.queryByText("Adding photo…")).toBeNull();
    expect(
      document.querySelector(".photo-status-chip")?.childElementCount,
    ).toBe(2);
    expect(screen.getByRole("progressbar")).toHaveValue(0.5);

    act(() => {
      updateOptimisticMediaUpload("batch-upload", {
        completedFiles: 2,
        stage: { state: "preparing" },
      });
    });
    expect(screen.getByText("Uploading 3 of 4…")).toBeVisible();
    expect(
      document.querySelector(".photo-status-chip")?.childElementCount,
    ).toBe(2);

    act(() => {
      updateOptimisticMediaUpload("batch-upload", {
        completedFiles: 2,
        stage: { state: "uploading", progress: 0.62 },
      });
    });
    expect(screen.getByText("Uploading 3 of 4…")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveValue(0.62);
    expect(
      document.querySelector(".photo-status-chip")?.childElementCount,
    ).toBe(2);
  });

  it("keeps Uploading… for a single photo instead of Adding photo copy", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    addOptimisticMediaUpload({
      id: "single-upload",
      circleId,
      kind: "photo",
      body: "One photo",
      occurredOn: "2026-09-01",
      occurredTime: "",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:single",
      stage: { state: "processing" },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    expect(screen.getByText("Uploading…")).toBeVisible();
    expect(screen.queryByText("Adding your photo…")).toBeNull();
    expect(screen.queryByText("Adding photo…")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveValue(1);
  });

  it.each([
    ["needs_attention", "operator_review"],
    ["cancelled_cleanup_pending", "queued"],
  ])(
    "retains a failed placeholder when the intake list reports %s",
    async (serverStatus, cleanupState) => {
      mocks.rpc.mockResolvedValue({
        data: [
          {
            ...serverRow,
            can_cancel: false,
            cleanup_state: cleanupState,
            status: serverStatus,
          },
        ],
        error: null,
      });
      addOptimisticMediaUpload({
        id: `listed-${serverStatus}`,
        circleId,
        kind: "photo",
        body: "Keep this note with the failed upload.",
        occurredOn: "2026-09-01",
        occurredTime: "14:58",
        journalPersonId: "person-1",
        journalPersonName: "Brian",
        journalPersonInitial: "B",
        journalPersonAccent: "teal",
        previewUrl: `blob:private-${serverStatus}`,
        intakeId,
        stage: { state: "processing" },
      });

      render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

      expect(await screen.findByText("Upload failed")).toBeVisible();
      expect(
        screen.queryByText("Keep this note with the failed upload."),
      ).toBeNull();
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
      expect(screen.queryByRole("img")).toBeNull();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it.each(["needs_attention", "cancelled"])(
    "does not mistake an absent %s intake for a published photo",
    async (terminalStatus) => {
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "list_my_photo_intakes") {
          return { data: [], error: null };
        }
        if (name === "get_photo_moment_status") {
          return {
            data: [{ moment_id: null, status: terminalStatus }],
            error: null,
          };
        }
        return { data: null, error: { message: "Unexpected RPC" } };
      });
      addOptimisticMediaUpload({
        id: `absent-${terminalStatus}`,
        circleId,
        kind: "photo",
        body: "This entry must not silently disappear.",
        occurredOn: "2026-09-01",
        occurredTime: "15:01",
        journalPersonId: "person-1",
        journalPersonName: "Brian",
        journalPersonInitial: "B",
        journalPersonAccent: "teal",
        previewUrl: `blob:private-${terminalStatus}`,
        intakeId,
        stage: { state: "processing" },
      });

      render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

      expect(await screen.findByText("Upload failed")).toBeVisible();
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
      expect(
        screen.queryByText("This entry must not silently disappear."),
      ).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledWith("get_photo_moment_status", {
        intake_id: intakeId,
      });
    },
  );

  it("removes an absent placeholder only after explicit publication", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "list_my_photo_intakes") {
        return { data: [], error: null };
      }
      if (name === "get_photo_moment_status") {
        return {
          data: [{ moment_id: serverRow.moment_id, status: "published" }],
          error: null,
        };
      }
      return { data: null, error: { message: "Unexpected RPC" } };
    });
    addOptimisticMediaUpload({
      id: "confirmed-published-upload",
      circleId,
      kind: "photo",
      body: "Published after processing.",
      occurredOn: "2026-09-01",
      occurredTime: "15:03",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:private-published",
      intakeId,
      stage: { state: "processing" },
    });

    render(<PhotoStatusShelf circleId={circleId} today="2026-09-01" />);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.queryByText("Published after processing.")).toBeNull();
    expect(screen.queryByText("Upload failed")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("get_photo_moment_status", {
      intake_id: intakeId,
    });
  });

  it("shows server-authoritative unfinished work even without local browser state", async () => {
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("Photo upload paused")).toBeVisible();
    expect(screen.getByText(/A Organizer One/)).toBeVisible();
    expect(mocks.rpc).toHaveBeenCalledWith("list_my_photo_intakes", {
      circle_id: circleId,
    });
    expect(mocks.listForScope).toHaveBeenCalledWith(accountId, circleId);
    expect(
      screen.getByRole("button", { name: /Cancel upload for A Organizer One/ }),
    ).toBeVisible();
  });

  it("finishes processing automatically with only a quiet status", async () => {
    const processRequest = vi.fn(async () =>
      Response.json({ ok: true }, { status: 202 }),
    );
    vi.stubGlobal("fetch", processRequest);
    mocks.rpc.mockResolvedValue({
      data: [{ ...serverRow, can_cancel: false, status: "processing" }],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("Uploading…")).toBeVisible();
    expect(screen.queryByText("Adding your photo…")).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel upload/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try finishing" })).toBeNull();
    await waitFor(() =>
      expect(processRequest).toHaveBeenCalledWith(
        "/api/photos/process",
        expect.objectContaining({
          body: JSON.stringify({ intakeId }),
          credentials: "same-origin",
          method: "POST",
        }),
      ),
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("cancels through the server before removing matching local resume state", async () => {
    mocks.listForScope.mockResolvedValue([localRecord]);
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    await user.click(
      await screen.findByRole("button", {
        name: /Cancel upload for A Organizer One/,
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith("cancel_photo_intake", {
      intake_id: intakeId,
    });
    await user.click(
      screen.getByRole("button", {
        name: /Confirm cancellation for A Organizer One/,
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_photo_intake", {
      intake_id: intakeId,
    });
    expect(mocks.remove).toHaveBeenCalledWith(localRecord.id);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Private photo status" }),
      ).toBeNull(),
    );
    expect(screen.queryByText("Photo cancelled")).toBeNull();
  });

  it("keeps confirmed server cancellation when local browser cleanup fails", async () => {
    mocks.listForScope
      .mockResolvedValueOnce([localRecord])
      .mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    await user.click(
      await screen.findByRole("button", {
        name: /Cancel upload for A Organizer One/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: /Confirm cancellation for A Organizer One/,
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Private photo status" }),
      ).toBeNull(),
    );
    expect(screen.queryByText(/saved upload shortcut/u)).toBeNull();
  });

  it("renders authoritative server state when IndexedDB reconciliation fails", async () => {
    mocks.listForScope.mockRejectedValue(new Error("IndexedDB unavailable"));
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("Photo upload paused")).toBeVisible();
    expect(screen.queryByText("Couldn’t check your photo yet")).toBeNull();
  });

  it("keeps the item and does not claim cancellation when confirmation fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "cancel_photo_intake"
        ? { data: null, error: { message: "offline" } }
        : { data: [serverRow], error: null },
    );
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    await user.click(
      await screen.findByRole("button", {
        name: /Cancel upload for A Organizer One/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: /Confirm cancellation for A Organizer One/,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cancellation couldn’t be confirmed",
    );
    expect(screen.getByText("Photo upload paused")).toBeVisible();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not erase local resume state based only on list absence", async () => {
    mocks.listForScope.mockResolvedValue([localRecord]);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.listForScope).toHaveBeenCalledOnce());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("hides published cleanup and refreshes the timeline", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...serverRow,
          can_cancel: false,
          status: "published_cleanup_pending",
        },
      ],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("refreshes the timeline only once for the same published intake", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...serverRow,
          can_cancel: false,
          cleanup_state: "queued",
          status: "published_cleanup_pending",
        },
      ],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh the timeline again after a published shelf remount", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...serverRow,
          can_cancel: false,
          cleanup_state: "queued",
          status: "published_cleanup_pending",
        },
      ],
      error: null,
    });
    const firstPage = render(<PhotoStatusShelf circleId={circleId} />);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());

    firstPage.unmount();
    render(<PhotoStatusShelf circleId={circleId} />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("hides cleanup operator-review details from the family timeline", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...serverRow,
          can_cancel: false,
          cleanup_state: "operator_review",
          status: "cancelled_cleanup_pending",
        },
      ],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("does not let a delayed status poll overwrite confirmed cancellation", async () => {
    let resolveDelayed!: (value: unknown) => void;
    let listCalls = 0;
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "cancel_photo_intake") {
        return Promise.resolve({
          data: [
            {
              cleanup_state: "queued",
              intake_id: intakeId,
              state: "invalidated",
            },
          ],
          error: null,
        });
      }
      listCalls += 1;
      if (listCalls === 1) {
        return Promise.resolve({ data: [serverRow], error: null });
      }
      return new Promise((resolve) => {
        resolveDelayed = resolve;
      });
    });
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);
    await screen.findByText("Photo upload paused");
    await waitFor(() => expect(mocks.listForScope).toHaveBeenCalledOnce());

    fireEvent(window, new Event("online"));
    await waitFor(() => expect(listCalls).toBe(2));
    await user.click(
      screen.getByRole("button", {
        name: /Cancel upload for A Organizer One/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: /Confirm cancellation for A Organizer One/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Private photo status" }),
      ).toBeNull(),
    );

    resolveDelayed({ data: [serverRow], error: null });
    await Promise.resolve();
    expect(screen.queryByText("Photo upload paused")).toBeNull();
  });

  it("keeps an unknown authoritative status quiet until a later poll", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...serverRow, status: "surprise" }],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("hides cancelled cleanup details", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...serverRow,
          can_cancel: false,
          cleanup_state: "queued",
          status: "cancelled_cleanup_pending",
        },
      ],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
    expect(screen.queryByText("Photo cancelled")).toBeNull();
    expect(screen.queryByText(/secure removal/u)).toBeNull();
  });

  it("does not overlap refreshes and clears visible state during sign-out", async () => {
    let resolveList!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    addOptimisticMediaUpload({
      id: "private-local-upload",
      circleId,
      kind: "photo",
      body: "Private draft text",
      occurredOn: "2026-09-01",
      occurredTime: "15:04",
      journalPersonId: "person-1",
      journalPersonName: "Brian",
      journalPersonInitial: "B",
      journalPersonAccent: "teal",
      previewUrl: "blob:private-sign-out-preview",
      stage: { state: "uploading", progress: 0.2 },
    });
    render(<PhotoStatusShelf circleId={circleId} />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());

    fireEvent(window, new Event("online"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    resolveList({ data: [serverRow], error: null });
    expect(await screen.findByText("Uploading…")).toBeVisible();
    expect(screen.queryByText("Private draft text")).toBeNull();

    fireEvent(window, new Event("our-days:clear-private-state"));
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
    expect(screen.queryByText("Uploading…")).toBeNull();
  });
});
