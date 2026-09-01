import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => vi.unstubAllGlobals());

describe("PhotoStatusShelf", () => {
  it("shows server-authoritative unfinished work even without local browser state", async () => {
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();
    expect(screen.getByText(/A Organizer One/)).toBeVisible();
    expect(mocks.rpc).toHaveBeenCalledWith("list_my_photo_intakes", {
      circle_id: circleId,
    });
    expect(mocks.listForScope).toHaveBeenCalledWith(accountId, circleId);
    expect(
      screen.getByRole("button", { name: /Cancel upload for A Organizer One/ }),
    ).toBeVisible();
  });

  it("describes processing truthfully and removes the unsafe cancel action", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...serverRow, can_cancel: false, status: "processing" }],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    expect(
      screen.getByText(
        "It is being prepared privately and can’t be cancelled safely now.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Cancel upload/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Try finishing" })).toBeVisible();
  });

  it("retries private processing only when the user asks", async () => {
    const processRequest = vi.fn(async () =>
      Response.json({ ok: true }, { status: 202 }),
    );
    vi.stubGlobal("fetch", processRequest);
    mocks.rpc.mockResolvedValue({
      data: [{ ...serverRow, can_cancel: false, status: "processing" }],
      error: null,
    });
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    await user.click(
      await screen.findByRole("button", { name: "Try finishing" }),
    );
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
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
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
    expect(await screen.findByText("Photo cancelled")).toBeVisible();
    expect(
      screen.getByText(
        "It won’t be added. Its temporary private upload copy is waiting for secure removal.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Cancellation confirmed",
    );
    expect(screen.getByText(/Cancellation confirmed/)).toHaveFocus();
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

    expect(await screen.findByText("Photo cancelled")).toBeVisible();
    expect(screen.getByText(/Cancellation confirmed/)).toBeVisible();
    expect(
      await screen.findByText(/couldn’t remove its saved upload shortcut/u),
    ).toBeVisible();
  });

  it("renders authoritative server state when IndexedDB reconciliation fails", async () => {
    mocks.listForScope.mockRejectedValue(new Error("IndexedDB unavailable"));
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();
    expect(await screen.findByText(/Photo status is current/u)).toBeVisible();
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
    expect(screen.getByText("Private upload not finished")).toBeVisible();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("clears stale local resume state only after a successful authoritative check", async () => {
    mocks.listForScope.mockResolvedValue([localRecord]);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith(localRecord.id),
    );
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("keeps published cleanup visible and refreshes the timeline", async () => {
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

    expect(await screen.findByText("Photo added privately")).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledOnce();
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

    expect(await screen.findByText("Photo added privately")).toBeVisible();
    await waitFor(() => expect(mocks.listForScope).toHaveBeenCalledOnce());
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
    expect(await screen.findByText("Photo added privately")).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledOnce();

    firstPage.unmount();
    render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Photo added privately")).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("reports cleanup operator review without promising ongoing removal", async () => {
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

    expect(
      await screen.findByText("Private cleanup needs attention"),
    ).toBeVisible();
    expect(screen.getByText(/needs private maintenance/u)).toBeVisible();
    expect(screen.queryByText(/is being removed/u)).toBeNull();
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
    await screen.findByText("Private upload not finished");
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
    expect(await screen.findByText("Photo cancelled")).toBeVisible();

    resolveDelayed({ data: [serverRow], error: null });
    await Promise.resolve();
    expect(screen.getByText("Photo cancelled")).toBeVisible();
    expect(screen.queryByText("Private upload not finished")).toBeNull();
  });

  it("fails closed for an unknown or unavailable authoritative status", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ ...serverRow, status: "surprise" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [serverRow], error: null });
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t check your photo yet",
    );
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();
  });

  it("does not overlap refreshes and clears visible state during sign-out", async () => {
    let resolveList!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    render(<PhotoStatusShelf circleId={circleId} />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());

    fireEvent(window, new Event("online"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    resolveList({ data: [serverRow], error: null });
    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();

    fireEvent(window, new Event("our-days:clear-private-state"));
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });
});
