import { IDBFactory } from "fake-indexeddb";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    getSession: vi.fn(),
    refresh,
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

import { PhotoStatusShelf } from "./photo-status-shelf";
import {
  photoUploadResumeStore,
  type PhotoUploadResumeRecord,
} from "./photo-upload-resume-store";

const accountId = "10000000-0000-4000-8000-000000000001";
const circleId = "20000000-0000-4000-8000-000000000001";
const record: PhotoUploadResumeRecord = {
  id: "resume-reload",
  accountId,
  acknowledged: true,
  circleId,
  draftHash: "a".repeat(64),
  fileSha256: "b".repeat(64),
  fileSize: 1_024,
  intakeId: "d6000000-0000-4000-8000-000000000001",
  mimeType: "image/jpeg",
  momentId: "d6000000-0000-4000-8000-000000000002",
  requestKey: "request-reload",
  uploadRequestKey: "upload-request-reload",
};

beforeEach(() => {
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: new IDBFactory(),
  });
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: accountId } } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: [{ moment_id: null, status: "processing" }],
    error: null,
  });
});

describe("PhotoStatusShelf reload recovery", () => {
  it("keeps an unacknowledged unexpired record neutral after remount", async () => {
    await photoUploadResumeStore.save({
      ...record,
      acknowledged: false,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    const firstPage = render(<PhotoStatusShelf circleId={circleId} />);
    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();
    expect(screen.queryByText("Private upload in progress")).toBeNull();
    firstPage.unmount();

    render(<PhotoStatusShelf circleId={circleId} />);
    expect(
      await screen.findByText("Private upload not finished"),
    ).toBeVisible();
    expect(screen.queryByText("Private upload in progress")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("survives a remount, then clears and refreshes after publication", async () => {
    await photoUploadResumeStore.save(record);

    const firstPage = render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    firstPage.unmount();

    const reloadedPage = render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    await expect(
      photoUploadResumeStore.listForScope(accountId, circleId),
    ).resolves.toEqual([record]);
    reloadedPage.unmount();

    mocks.rpc.mockResolvedValue({
      data: [{ moment_id: record.momentId, status: "published" }],
      error: null,
    });
    render(<PhotoStatusShelf circleId={circleId} />);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    await expect(
      photoUploadResumeStore.listForScope(accountId, circleId),
    ).resolves.toEqual([]);
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });
});
