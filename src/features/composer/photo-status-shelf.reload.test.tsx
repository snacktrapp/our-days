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
const intakeId = "d6000000-0000-4000-8000-000000000001";
const record: PhotoUploadResumeRecord = {
  id: "resume-reload",
  accountId,
  acknowledged: true,
  circleId,
  draftHash: "a".repeat(64),
  fileSha256: "b".repeat(64),
  fileSize: 1_024,
  intakeId,
  mimeType: "image/jpeg",
  momentId: "d6000000-0000-4000-8000-000000000002",
  requestKey: "request-reload",
  uploadRequestKey: "upload-request-reload",
};
const serverRow = {
  can_cancel: false,
  cleanup_state: "not_requested",
  intake_id: intakeId,
  journal_person_id: "30000000-0000-4000-8000-000000000001",
  journal_person_name: "A Organizer One",
  moment_id: record.momentId!,
  occurred_on: "2026-08-21",
  requested_at: "2026-08-31T12:00:00Z",
  status: "processing",
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
  mocks.rpc.mockResolvedValue({ data: [serverRow], error: null });
});

describe("PhotoStatusShelf reload recovery", () => {
  it("survives remount from server state when this browser has no resume record", async () => {
    const firstPage = render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    firstPage.unmount();

    render(<PhotoStatusShelf circleId={circleId} />);
    expect(await screen.findByText("Preparing your photo")).toBeVisible();
    await expect(
      photoUploadResumeStore.listForScope(accountId, circleId),
    ).resolves.toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith("list_my_photo_intakes", {
      circle_id: circleId,
    });
  });

  it("removes an obsolete browser resume record after the server no longer counts it", async () => {
    await photoUploadResumeStore.save(record);
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    render(<PhotoStatusShelf circleId={circleId} />);
    await waitFor(async () => {
      await expect(
        photoUploadResumeStore.listForScope(accountId, circleId),
      ).resolves.toEqual([]);
    });
    expect(
      screen.queryByRole("region", { name: "Private photo status" }),
    ).toBeNull();
  });
});
