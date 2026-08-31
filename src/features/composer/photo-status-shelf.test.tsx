import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const record = {
  id: "resume-1",
  accountId,
  acknowledged: true,
  circleId,
  draftHash: "a".repeat(64),
  fileSha256: "b".repeat(64),
  fileSize: 1_024,
  intakeId: "d6000000-0000-4000-8000-000000000001",
  mimeType: "image/jpeg",
  momentId: "d6000000-0000-4000-8000-000000000002",
  requestKey: "request-1",
  uploadRequestKey: "upload-request-1",
  uploadUrl: "https://example.invalid/storage/v1/upload/resumable/id",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: accountId } } },
    error: null,
  });
  mocks.listForScope.mockResolvedValue([]);
  mocks.remove.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({
    data: [{ moment_id: null, status: "processing" }],
    error: null,
  });
});

describe("PhotoStatusShelf", () => {
  it("shows a quiet durable processing state without family content", async () => {
    mocks.listForScope.mockResolvedValue([
      { ...record, expiresAt: "2000-01-01T00:00:00.000Z" },
    ]);
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    expect(
      screen.getByText("It will appear in the timeline when it is ready."),
    ).toBeVisible();
    expect(mocks.listForScope).toHaveBeenCalledWith(accountId, circleId);
    expect(document.body.textContent).not.toContain(record.fileSha256);
    expect(document.body.textContent).not.toContain(record.uploadUrl);
  });

  it("uses neutral language for an unacknowledged unexpired upload", async () => {
    mocks.listForScope.mockResolvedValue([
      {
        ...record,
        acknowledged: false,
        expiresAt: "2999-01-01T00:00:00.000Z",
      },
    ]);
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();
    expect(screen.queryByText("Upload didn’t finish")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports an expired unacknowledged upload as interrupted", async () => {
    mocks.listForScope.mockResolvedValue([
      {
        ...record,
        acknowledged: false,
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
    ]);
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("Upload didn’t finish")).toBeVisible();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps needs-attention visible until the member dismisses it", async () => {
    mocks.listForScope.mockResolvedValue([record]);
    mocks.rpc.mockResolvedValue({
      data: [{ moment_id: null, status: "needs_attention" }],
      error: null,
    });
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByText("This photo needs attention")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mocks.remove).toHaveBeenCalledWith(record.id);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Private photo status" }),
      ).toBeNull(),
    );
  });

  it("offers an explicit retry when private status cannot be checked", async () => {
    mocks.listForScope.mockResolvedValue([record]);
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({
        data: [{ moment_id: null, status: "processing" }],
        error: null,
      });
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t check your photo yet",
    );
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails closed when the server returns an unknown status", async () => {
    mocks.listForScope.mockResolvedValue([record]);
    mocks.rpc.mockResolvedValue({
      data: [{ moment_id: null, status: "surprise" }],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t check its status yet.",
    );
    expect(screen.queryByText("Preparing your photo")).toBeNull();
  });

  it("removes a published record and refreshes the timeline", async () => {
    mocks.listForScope.mockResolvedValue([record]);
    mocks.rpc.mockResolvedValue({
      data: [{ moment_id: record.momentId, status: "published" }],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(record.id));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("clears visible status immediately during sign-out purge", async () => {
    mocks.listForScope.mockResolvedValue([record]);
    render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Preparing your photo")).toBeVisible();

    fireEvent(window, new Event("our-days:clear-private-state"));
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });

  it("does not overlap a manual check with one already in flight", async () => {
    let resolveStatus!: (value: unknown) => void;
    mocks.listForScope.mockResolvedValue([record]);
    mocks.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    render(<PhotoStatusShelf circleId={circleId} />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());

    fireEvent(window, new Event("online"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    resolveStatus({
      data: [{ moment_id: null, status: "processing" }],
      error: null,
    });
    expect(await screen.findByText("Preparing your photo")).toBeVisible();
  });

  it("does not let a delayed check restore an item being dismissed", async () => {
    let resolveStatus!: (value: unknown) => void;
    mocks.listForScope.mockResolvedValue([
      {
        ...record,
        acknowledged: false,
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
    ]);
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Upload didn’t finish")).toBeVisible();

    mocks.listForScope.mockResolvedValue([record]);
    mocks.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    resolveStatus({
      data: [{ moment_id: null, status: "processing" }],
      error: null,
    });

    await waitFor(() =>
      expect(screen.queryByText("Preparing your photo")).toBeNull(),
    );
  });

  it("keeps the notice and reports a failed dismiss", async () => {
    mocks.listForScope.mockResolvedValue([
      {
        ...record,
        acknowledged: false,
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
    ]);
    mocks.remove.mockRejectedValue(new Error("IndexedDB failed"));
    const user = userEvent.setup();
    render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Upload didn’t finish")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("Upload didn’t finish")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t dismiss this notice. Try Dismiss again.",
    );
    expect(screen.queryByText("Couldn’t check your photo yet")).toBeNull();
  });
});
