import { type ComponentProps, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MomentComposer } from "./moment-composer";
import { selectBiblePassage } from "./bible-verse-catalog";
import { emptyPlaceSelection } from "@/lib/place-coordinates";
import { PhotoUploadError } from "./photo-upload";
import {
  clearOptimisticMediaUploads,
  optimisticMediaUploadSnapshot,
} from "./optimistic-media-upload";
import {
  clearOptimisticMomentSaves,
  optimisticMomentSaveSnapshot,
  retryOptimisticMomentSave,
} from "./optimistic-moment-save";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));
const photoUpload = vi.hoisted(() => ({
  upload: vi.fn(),
}));
const videoUpload = vi.hoisted(() => ({
  upload: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/family",
}));
vi.mock("./photo-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./photo-upload")>()),
  uploadPhotoMoment: photoUpload.upload,
}));
vi.mock("./video-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./video-upload")>()),
  uploadVideoMoment: videoUpload.upload,
}));

const people = [
  {
    id: "brian",
    name: "Brian",
    initial: "B",
    accent: "teal",
    contextLabel: "You",
  },
  {
    id: "molly",
    name: "Molly",
    initial: "M",
    accent: "clay",
    contextLabel: "Co-organizer",
  },
  {
    id: "avery",
    name: "Avery",
    initial: "A",
    accent: "ochre",
    contextLabel: "Child journal",
  },
] as const;

const journalPeople = [people[0], people[2]] as const;

const model = {
  previewToday: "2026-08-28",
  defaultJournalPersonId: "brian",
  recorderPersonId: "brian",
  recordedByName: "Brian",
  journalPeople,
  taggablePeople: people,
} as const;

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open composer
      </button>
      <MomentComposer
        model={model}
        open={open}
        returnFocusRef={triggerRef}
        onRequestClose={() => setOpen(false)}
      />
    </>
  );
}

function ConnectedHarness({
  save,
}: {
  save: NonNullable<ComponentProps<typeof MomentComposer>["saveWrittenMoment"]>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open connected composer
      </button>
      <MomentComposer
        model={{ ...model, experience: "connected-written" }}
        open={open}
        returnFocusRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        saveWrittenMoment={save}
      />
    </>
  );
}

function ConnectedFamilyHarness({
  save = vi.fn(),
}: {
  save?: ComponentProps<typeof MomentComposer>["saveFamilyMoment"];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open connected family composer
      </button>
      <MomentComposer
        model={{
          ...model,
          circleId: "20000000-0000-4000-8000-000000000001",
          experience: "connected-family",
          photoPostingEnabled: true,
        }}
        open={open}
        returnFocusRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        saveFamilyMoment={save}
      />
    </>
  );
}

let createdUrlCount = 0;
const createObjectURL = vi.fn(
  () => `blob:composer-preview-${++createdUrlCount}`,
);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createdUrlCount = 0;
  window.sessionStorage.clear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  navigation.refresh.mockClear();
  navigation.replace.mockClear();
  photoUpload.upload.mockReset();
  videoUpload.upload.mockReset();
  clearOptimisticMediaUploads();
  clearOptimisticMomentSaves();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  clearOptimisticMediaUploads();
  clearOptimisticMomentSaves();
  vi.restoreAllMocks();
});

async function openComposer() {
  const user = userEvent.setup({ applyAccept: false });
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Open composer" }));
  return user;
}

async function setComposerTime(
  user: ReturnType<typeof userEvent.setup>,
  hour: string,
  minute: string,
  period: "AM" | "PM",
) {
  await user.click(screen.getByRole("button", { name: /No time/u }));
  await user.selectOptions(screen.getByLabelText("Hour"), hour);
  await user.selectOptions(screen.getByLabelText("Minute"), minute);
  await user.selectOptions(screen.getByLabelText("AM or PM"), period);
  await user.click(screen.getByRole("button", { name: "Set time" }));
}

async function setComposerPlace(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: /^Place,/u }));
  await user.type(screen.getByLabelText("Place name"), name);
}

async function setComposerDate(
  user: ReturnType<typeof userEvent.setup>,
  target: string,
) {
  await user.click(screen.getByRole("button", { name: /Aug 28, 2026/u }));
  const targetDate = new Date(`${target}T12:00:00`);
  const monthDelta =
    (2026 - targetDate.getFullYear()) * 12 + (7 - targetDate.getMonth());
  const previousMonth = screen.getByRole("button", {
    name: "Previous month",
  });
  for (let index = 0; index < monthDelta; index += 1) {
    fireEvent.click(previousMonth);
  }
  await user.click(
    screen.getByRole("button", {
      name: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(targetDate),
    }),
  );
}

async function selectComposerBiblePassage(
  user: ReturnType<typeof userEvent.setup>,
  passage: Readonly<{
    book: string;
    chapter: number;
    start: number;
    end?: number;
  }>,
) {
  await user.click(screen.getByRole("button", { name: /^Book,/u }));
  await user.click(
    screen.getByRole("menuitemradio", {
      name: (accessibleName) => accessibleName === passage.book,
    }),
  );
  await user.click(screen.getByRole("button", { name: /^Chapter,/u }));
  await user.click(
    screen.getByRole("button", { name: `Chapter ${passage.chapter}` }),
  );
  await user.click(screen.getByRole("button", { name: /^Starting verse,/u }));
  await user.click(
    screen.getByRole("button", { name: `Starting verse ${passage.start}` }),
  );
  if (passage.end && passage.end !== passage.start) {
    await user.click(screen.getByRole("button", { name: /^Ending verse,/u }));
    await user.click(
      screen.getByRole("button", { name: `Ending verse ${passage.end}` }),
    );
  }
}

async function selectComposerJournal(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  let trigger = screen.queryByRole("button", { name: /Brian · You/u });
  if (!trigger) {
    await user.click(screen.getByRole("button", { name: /Details/u }));
    trigger = screen.getByRole("button", { name: /Brian · You/u });
  }
  await user.click(trigger);
  await user.click(
    screen.getByRole("menuitemradio", { name: new RegExp(name) }),
  );
}

describe("MomentComposer", () => {
  it("offers only the production-ready written path in a connected journal", async () => {
    const user = userEvent.setup();
    render(
      <ConnectedHarness
        save={vi.fn().mockResolvedValue({ ok: true, message: "Saved" })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open connected composer" }),
    );
    expect(screen.getByText("Family only")).toBeVisible();
    expect(screen.getByRole("heading", { name: "New moment" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Photo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Milestone/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Location/ })).toBeNull();
  });

  it("shows gated connected Photo and reports private processing honestly", async () => {
    photoUpload.upload.mockImplementation(
      async (
        _file: File,
        _draft: unknown,
        _attempt: unknown,
        _signal: AbortSignal,
        onStage: (stage: unknown) => void,
      ) => {
        onStage({ state: "uploading", progress: 0.5 });
        onStage({ state: "processing" });
        return {
          state: "processing",
          intakeId: "d6000000-0000-4000-8000-000000000001",
          momentId: "d6000000-0000-4000-8000-000000000002",
        };
      },
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    const photoChoice = screen.getByRole("button", { name: /^Photo/u });
    expect(screen.getByRole("heading", { name: "New moment" })).toHaveFocus();
    await user.click(photoChoice);
    const picker = screen.getByLabelText(/Choose photo/u);
    await user.upload(
      picker,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    expect(screen.getByText("Photo ready to upload privately.")).toBeVisible();
    await user.type(screen.getByLabelText("Note"), "Kept exactly once.");
    await setComposerTime(user, "2", "45", "PM");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(optimisticMediaUploadSnapshot()).toEqual([
      expect.objectContaining({
        body: "Kept exactly once.",
        occurredTime: "14:45",
        stage: { state: "processing" },
      }),
    ]);
    expect(
      screen.getByRole("button", { name: "Open connected family composer" }),
    ).toHaveFocus();
    expect(photoUpload.upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        circleId: "20000000-0000-4000-8000-000000000001",
        body: "Kept exactly once.",
        journalPersonId: "brian",
        occurredAt: expect.any(String),
      }),
      expect.objectContaining({
        requestKey: expect.any(String),
        uploadRequestKey: expect.any(String),
      }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("selects, validates, and saves a short video through the media card", async () => {
    videoUpload.upload.mockImplementation(
      async (
        _file: File,
        _draft: unknown,
        _attempt: unknown,
        _signal: AbortSignal,
        onStage: (stage: unknown) => void,
      ) => {
        onStage({ state: "uploading", progress: 0.5 });
        onStage({ state: "finishing" });
        return { momentId: "d6000000-0000-4000-8000-000000000012" };
      },
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo or video/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo or video/u),
      new File([new Uint8Array(24)], "first-steps.mp4", {
        type: "video/mp4",
      }),
    );
    const preview = screen.getByLabelText("Selected video preview");
    Object.defineProperties(preview, {
      duration: { configurable: true, value: 12.4 },
      videoHeight: { configurable: true, value: 1080 },
      videoWidth: { configurable: true, value: 1920 },
    });
    fireEvent.loadedMetadata(preview);
    fireEvent.loadedData(preview);

    expect(screen.getByText("Video ready to upload privately.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(videoUpload.upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ durationMs: 12_400 }),
      expect.objectContaining({ requestKey: expect.any(String) }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("rejects HEIC truthfully before a connected upload starts", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File(["heic"], "iphone.heic", { type: "image/heic" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "For now, choose a JPEG, PNG, or WebP photo.",
    );
    expect(photoUpload.upload).not.toHaveBeenCalled();
  });

  it("closes immediately while a photo continues uploading from an immutable draft", async () => {
    let finishUpload: (
      value: Readonly<{
        state: "processing";
        intakeId: string;
        momentId: string;
      }>,
    ) => void = () => {
      throw new Error("Upload was not started.");
    };
    photoUpload.upload.mockImplementation(
      async (
        _file: File,
        _draft: unknown,
        _attempt: unknown,
        signal: AbortSignal,
        onStage: (stage: unknown) => void,
      ) => {
        onStage({ state: "uploading", progress: 0.25 });
        return new Promise((resolve) => {
          finishUpload = resolve;
        });
      },
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    await user.type(screen.getByLabelText("Note"), "Still in the post.");
    await setComposerTime(user, "2", "45", "PM");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(optimisticMediaUploadSnapshot()).toEqual([
      expect.objectContaining({
        body: "Still in the post.",
        occurredTime: "14:45",
        stage: { state: "uploading", progress: 0.25 },
      }),
    ]);
    expect(photoUpload.upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        body: "Still in the post.",
        occurredAt: expect.any(String),
        occurredOn: "2026-08-28",
      }),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    finishUpload({
      state: "processing",
      intakeId: "d6000000-0000-4000-8000-000000000001",
      momentId: "d6000000-0000-4000-8000-000000000002",
    });
    await waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "processing",
      }),
    );
  });

  it("does not abort the detached upload when its composer unmounts", async () => {
    let resolveUpload!: (value: {
      state: "processing";
      intakeId: string;
      momentId: string;
    }) => void;
    let uploadSignal: AbortSignal | undefined;
    photoUpload.upload.mockImplementation(
      async (
        _file: File,
        _draft: unknown,
        _attempt: unknown,
        signal: AbortSignal,
      ) => {
        uploadSignal = signal;
        return new Promise((resolve) => {
          resolveUpload = resolve;
        });
      },
    );
    const user = userEvent.setup({ applyAccept: false });
    const rendered = render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    rendered.unmount();

    expect(uploadSignal?.aborted).toBe(false);
    resolveUpload({
      state: "processing",
      intakeId: "d6000000-0000-4000-8000-000000000021",
      momentId: "d6000000-0000-4000-8000-000000000022",
    });
    await waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "processing",
      }),
    );
  });

  it("aborts and removes private local media at an account boundary", async () => {
    let uploadSignal: AbortSignal | undefined;
    photoUpload.upload.mockImplementation(
      async (
        _file: File,
        _draft: unknown,
        _attempt: unknown,
        signal: AbortSignal,
      ) => {
        uploadSignal = signal;
        return new Promise(() => undefined);
      },
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    window.dispatchEvent(new Event("our-days:clear-private-state"));
    expect(uploadSignal?.aborted).toBe(true);
    expect(optimisticMediaUploadSnapshot()).toEqual([]);
  });

  it("never lets an earlier upload completion erase a second draft", async () => {
    let resolveUpload!: (value: {
      state: "processing";
      intakeId: string;
      momentId: string;
    }) => void;
    photoUpload.upload.mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.type(screen.getByLabelText("Note"), "A separate second draft");
    resolveUpload({
      state: "processing",
      intakeId: "d6000000-0000-4000-8000-000000000031",
      momentId: "d6000000-0000-4000-8000-000000000032",
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Note")).toHaveValue(
        "A separate second draft",
      ),
    );
  });

  it("crosses an honest non-cancellable boundary before acknowledgement", async () => {
    let finish: () => void = () => {
      throw new Error("Upload was not started.");
    };
    photoUpload.upload.mockImplementation(
      async (
        _file: File,
        _draft: unknown,
        _attempt: unknown,
        _signal: AbortSignal,
        onStage: (stage: unknown) => void,
      ) => {
        onStage({ state: "uploading", progress: 1 });
        onStage({ state: "finishing" });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          state: "processing",
          intakeId: "d6000000-0000-4000-8000-000000000001",
          momentId: "d6000000-0000-4000-8000-000000000002",
        };
      },
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
      state: "finishing",
    });
    finish();
    await waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "processing",
      }),
    );
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("keeps a failed upload out of the next clean draft", async () => {
    photoUpload.upload.mockRejectedValue(
      new PhotoUploadError("Your private session needs to be renewed.", false),
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<ConnectedFamilyHarness />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "family.jpg", {
        type: "image/jpeg",
      }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(optimisticMediaUploadSnapshot()[0]?.stage).toEqual({
        state: "failed",
        message: "Your private session needs to be renewed.",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Try upload again" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "New moment" })).toBeVisible();
  });

  it("closes immediately and keeps a failed connected save actionable on the timeline", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "Try again safely." })
      .mockResolvedValueOnce({ ok: true, message: "Saved" });
    const user = userEvent.setup();
    render(<ConnectedHarness save={save} />);
    await user.click(
      screen.getByRole("button", { name: "Open connected composer" }),
    );
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    await user.type(screen.getByLabelText("Entry"), "Kept draft");
    await setComposerDate(user, "2023-08-21");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(optimisticMomentSaveSnapshot()[0]).toEqual(
        expect.objectContaining({
          body: "Kept draft",
          occurredOn: "2023-08-21",
          stage: { state: "failed", message: "Try again safely." },
        }),
      ),
    );

    retryOptimisticMomentSave(optimisticMomentSaveSnapshot()[0]!.id);
    await waitFor(() => expect(optimisticMomentSaveSnapshot()).toEqual([]));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: "Kept draft",
        journalPersonId: "brian",
        occurredOn: "2023-08-21",
      }),
    );
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith("/family");
  });

  it("closes immediately while a written save continues independently", async () => {
    let finishSave: (value: { ok: true; message: string }) => void = () => {
      throw new Error("The save promise was not started.");
    };
    const save = vi.fn(
      () =>
        new Promise<{ ok: true; message: string }>((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<ConnectedHarness save={save} />);
    await user.click(
      screen.getByRole("button", { name: "Open connected composer" }),
    );
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    await user.type(screen.getByLabelText("Entry"), "Still saving");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(optimisticMomentSaveSnapshot()[0]).toEqual(
      expect.objectContaining({
        body: "Still saving",
        stage: { state: "saving" },
      }),
    );
    expect(navigation.replace).toHaveBeenCalledWith("/family");

    finishSave({ ok: true, message: "Saved" });
    await waitFor(() => expect(optimisticMomentSaveSnapshot()).toEqual([]));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("closes immediately after save without a discard warning", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <ConnectedHarness
        save={vi.fn().mockResolvedValue({ ok: true, message: "Saved" })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open connected composer" }),
    );
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    await user.type(screen.getByLabelText("Entry"), "Already safe");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("opens honestly as a modal, locks body scroll, and restores focus", async () => {
    const user = await openComposer();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("dialog")).toHaveClass(
      "new-moment-composer-dialog",
    );
    expect(
      screen.queryByText(/Local design preview · Nothing is saved/u),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "New moment" })).toHaveFocus();
    expect(document.body).toHaveClass("composer-scroll-locked");

    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open composer" })).toHaveFocus();
    expect(document.body).not.toHaveClass("composer-scroll-locked");
  });

  it("saves a backdated local design entry without a review step", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /Written entry/ }));

    const text = screen.getByRole("textbox", { name: "Entry" });
    expect(screen.getByRole("button", { name: /Aug 28, 2026/u })).toBeVisible();
    expect(text.closest("form")).not.toBeNull();
    expect((text.closest("form") as HTMLFormElement).checkValidity()).toBe(
      false,
    );

    await user.type(text, "A brave blue door.");
    await setComposerDate(user, "2023-08-21");
    await selectComposerJournal(user, "Avery");
    await user.click(screen.getByRole("checkbox", { name: /Molly/ }));
    await setComposerPlace(user, "Oak Street School");
    expect(screen.queryByRole("heading", { name: "Review entry" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open composer" }));
    expect(screen.getByRole("button", { name: /Written entry/ })).toBeVisible();
    expect(screen.queryByDisplayValue("A brave blue door.")).toBeNull();
  }, 10_000);

  it.each([["Location", "Place name", "Sand Harbor"]])(
    "gives %s a distinct required title",
    async (choice, label, value) => {
      const user = await openComposer();
      await user.click(
        screen.getByRole("button", { name: new RegExp(choice) }),
      );
      await user.click(screen.getByRole("button", { name: /^Place,/u }));
      const requiredTitle = screen.getByLabelText(label);
      expect(requiredTitle).toHaveAttribute("aria-required", "true");
      await user.type(requiredTitle, value);
      expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    },
  );

  it("previews WEB text as soon as a starting verse is chosen and updates when the ending verse changes", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /Bible verse/ }));

    await user.click(screen.getByRole("button", { name: /^Book,/u }));
    await user.click(
      screen.getByRole("menuitemradio", {
        name: (accessibleName) => accessibleName === "John",
      }),
    );
    await user.click(screen.getByRole("button", { name: /^Chapter,/u }));
    await user.click(screen.getByRole("button", { name: "Chapter 3" }));
    expect(screen.queryByLabelText("Verse text")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Starting verse,/u }));
    await user.click(screen.getByRole("button", { name: "Starting verse 16" }));
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
      ).toContain("only born Son");
    });
    expect(
      (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
    ).not.toContain("should be saved through him");

    await user.click(screen.getByRole("button", { name: /^Ending verse,/u }));
    await user.click(screen.getByRole("button", { name: "Ending verse 17" }));
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
      ).toContain("should be saved through him");
    });
    expect(
      (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
    ).toContain("only born Son");
    expect(screen.queryByRole("heading", { name: "Review entry" })).toBeNull();
  });

  it("fills a Bible verse from cascaded book, chapter, and verse pickers", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /Bible verse/ }));

    expect(screen.getByRole("button", { name: /^Chapter,/u })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Starting verse,/u }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Ending verse,/u }),
    ).toBeDisabled();

    await selectComposerBiblePassage(user, {
      book: "1 Corinthians",
      chapter: 13,
      start: 4,
      end: 7,
    });

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
      ).toContain("Love is patient");
    });
    expect(
      screen.getByRole("button", { name: /^Book, 1 Corinthians/u }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Chapter, 13/u })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Starting verse, 4/u }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Ending verse, 7/u }),
    ).toBeVisible();
    expect(
      (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
    ).toContain("Love is patient");
    expect(
      (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
    ).toContain("endures all things.");
    expect(screen.getByLabelText("Verse text")).toHaveAttribute("readonly");
    expect(screen.queryByRole("heading", { name: "Review entry" })).toBeNull();
  });

  it("requires a selected Bible verse before save", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /Bible verse/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select a verse before saving this entry.",
    );
  });

  it("saves a selected Bible verse as a compatible written moment", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, message: "Saved" });
    const user = userEvent.setup();
    render(<ConnectedFamilyHarness save={save} />);
    await user.click(
      screen.getByRole("button", { name: "Open connected family composer" }),
    );
    await user.click(screen.getByRole("button", { name: /Bible verse/ }));
    await selectComposerBiblePassage(user, {
      book: "John",
      chapter: 3,
      start: 16,
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
      ).toContain("only born Son");
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "thought",
          title: "",
          body: expect.stringContaining("— John 3:16 · World English Bible"),
        }),
      ),
    );
  });

  it("edits a saved Bible verse with the same pickers and WEB preview", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, message: "Saved" });
    const create = vi.fn();
    const onRequestClose = vi.fn();
    const triggerRef = { current: null };
    const passage = await selectBiblePassage("Isaiah", 40, 28, 28);
    expect(passage).not.toBeNull();
    const user = userEvent.setup();
    render(
      <>
        <p id="journal-live-region" aria-live="assertive" />
        <MomentComposer
          model={{
            ...model,
            circleId: "20000000-0000-4000-8000-000000000001",
            experience: "connected-family",
            photoPostingEnabled: true,
          }}
          open
          editDraft={{
            momentId: "moment-verse",
            revision: 3,
            mode: "bible-verse",
            journalPersonId: "brian",
            occurredOn: "2026-09-02",
            maxOccurredOn: "2026-09-03",
            occurredTime: "",
            occurredAt: null,
            occurredTimezone: null,
            taggedPersonIds: ["molly"],
            place: emptyPlaceSelection(),
            verseSelection: {
              book: "Isaiah",
              chapter: 40,
              startVerse: 28,
              endVerse: 28,
            },
            title: passage!.reference,
            body: passage!.text,
            save: update,
          }}
          returnFocusRef={triggerRef}
          onRequestClose={onRequestClose}
          saveFamilyMoment={create}
        />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Add a Bible verse" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Edit this moment" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Choose another/u }),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Your thought" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Entry" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Book, Isaiah/u }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Chapter, 40/u })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Starting verse, 28/u }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Ending verse, 28/u }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
      ).toContain("everlasting God");
    });
    expect(screen.getByRole("checkbox", { name: "Molly" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        momentId: "moment-verse",
        revision: 3,
        title: "",
        body: expect.stringContaining("— Isaiah 40:28 · World English Bible"),
        taggedPersonIds: ["molly"],
      }),
    );
    expect(onRequestClose).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith("/family");
  });

  it("preserves a draft while choosing and confirms an incompatible type change", async () => {
    const user = await openComposer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Entry" }),
      "Keep this",
    );
    await user.click(screen.getByRole("button", { name: /Choose another/ }));
    expect(screen.getByText("Your current draft is still here.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    expect(screen.getByRole("textbox", { name: "Entry" })).toHaveValue(
      "Keep this",
    );
    await user.click(screen.getByRole("button", { name: /Choose another/ }));
    await user.click(screen.getByRole("button", { name: /Location/ }));
    expect(confirm).toHaveBeenCalledWith(
      "Discard this draft and choose another type?",
    );
    expect(screen.getByText("Your current draft is still here.")).toBeVisible();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /Location/ }));
    expect(
      screen.getByRole("button", { name: /^Place, Add a place/u }),
    ).toBeVisible();
  });

  it("validates image files before creating private temporary URLs", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    const picker = screen.getByLabelText(/Choose photo/u);

    await user.upload(picker, new File(["not an image"], "notes.txt"));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an image file for this preview.",
    );

    await user.upload(
      picker,
      new File([], "empty.jpg", { type: "image/jpeg" }),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That image is empty. Choose another one.",
    );

    const oversized = new File(["image"], "large.jpg", {
      type: "image/jpeg",
    });
    Object.defineProperty(oversized, "size", { value: 25 * 1024 * 1024 + 1 });
    await user.upload(picker, oversized);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an image smaller than 25 MB",
    );
  });

  it("rejects an image that the browser cannot decode", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    const picker = screen.getByLabelText(/Choose photo/u);
    await user.upload(
      picker,
      new File(["not really an image"], "broken.jpg", {
        type: "image/jpeg",
      }),
    );

    fireEvent.error(screen.getByAltText("Selected photo preview"));

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:composer-preview-1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This image could not be shown. Choose another one.",
    );
    expect(screen.queryByAltText("Selected photo preview")).toBeNull();
    expect(screen.getByLabelText(/Choose photo/u)).toHaveValue("");
  });

  it("requires a current decoded photo and ignores a stale image error", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    const picker = screen.getByLabelText(/Choose photo/u);
    await user.upload(
      picker,
      new File(["first"], "first.jpg", { type: "image/jpeg" }),
    );
    const firstPreview = screen.getByAltText("Selected photo preview");

    fireEvent.submit(picker.closest("form")!);
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wait for this photo to finish loading.",
    );

    await user.upload(
      picker,
      new File(["second"], "second.jpg", { type: "image/jpeg" }),
    );
    const secondPreview = screen.getByAltText("Selected photo preview");
    expect(secondPreview).not.toBe(firstPreview);
    fireEvent.error(firstPreview);
    expect(secondPreview).toBeVisible();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    fireEvent.load(secondPreview);
    fireEvent.submit(picker.closest("form")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("revokes photo URLs on replacement, removal, accepted discard, and completion", async () => {
    const user = await openComposer();
    const picker = async () => {
      await user.click(screen.getByRole("button", { name: /^Photo/u }));
      return screen.getByLabelText(/Choose photo/u);
    };
    let input = await picker();
    const first = new File(["first"], "first.jpg", { type: "image/jpeg" });
    const second = new File(["second"], "second.jpg", { type: "image/jpeg" });
    await user.upload(input, first);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("first.jpg")).toBeNull();

    await user.upload(input, second);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      1,
      "blob:composer-preview-1",
    );
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      2,
      "blob:composer-preview-2",
    );

    input = screen.getByLabelText(/Choose photo/u);
    await user.upload(input, first);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText("Selected photo preview")).toBeVisible();

    confirm.mockReturnValue(true);
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      3,
      "blob:composer-preview-3",
    );

    await user.click(screen.getByRole("button", { name: "Open composer" }));
    input = await picker();
    await user.upload(input, second);
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      4,
      "blob:composer-preview-4",
    );
  });

  it("revokes the current photo exactly once when the composer unmounts", async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open composer" }));
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File(["photo"], "private.jpg", { type: "image/jpeg" }),
    );
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:composer-preview-1");
  });

  it("revokes a photo exactly once when an accepted type change discards it", async () => {
    const user = await openComposer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    await user.upload(
      screen.getByLabelText(/Choose photo/u),
      new File(["photo"], "private.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: /Choose another/ }));
    await user.click(screen.getByRole("button", { name: /Location/ }));

    expect(confirm).toHaveBeenCalledWith(
      "Discard this draft and choose another type?",
    );
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:composer-preview-1");
    expect(
      screen.getByRole("button", { name: /^Place, Add a place/u }),
    ).toBeVisible();
  });

  it.each([
    ["Written entry", "Entry", "Write a thought"],
    ["Location", "Place name", "Name the place"],
  ])(
    "rejects whitespace-only required content for %s",
    async (choice, label, error) => {
      const user = await openComposer();
      await user.click(
        screen.getByRole("button", { name: new RegExp(choice) }),
      );
      if (choice === "Location") {
        await user.click(screen.getByRole("button", { name: /^Place,/u }));
      }
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value: " \n " } });
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("alert")).toHaveTextContent(error);
      if (choice === "Location") {
        expect(
          screen.getByRole("dialog", { name: "Choose a place" }),
        ).toBeVisible();
      } else {
        expect(field).toHaveFocus();
      }
      expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    },
  );

  it("removes a stale self-tag when its person becomes the journal", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    await user.click(screen.getByRole("button", { name: /Details/ }));
    const avery = screen.getByRole("checkbox", { name: /Avery/ });
    await user.click(avery);
    expect(avery).toBeChecked();

    await selectComposerJournal(user, "Avery");
    expect(avery).not.toBeChecked();
    expect(avery).toBeDisabled();
  });

  it.each([
    [
      "whitespace text",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByRole("textbox", { name: "Entry" }), " ");
      },
    ],
    [
      "date",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await setComposerDate(user, "2020-01-01");
      },
    ],
    [
      "journal",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await selectComposerJournal(user, "Avery");
      },
    ],
    [
      "people tag",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("button", { name: /Details/ }));
        await user.click(screen.getByRole("checkbox", { name: /Molly/ }));
      },
    ],
    [
      "place",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("button", { name: /Details/ }));
        await setComposerPlace(user, "The porch");
      },
    ],
  ])("treats a changed %s as a protected draft", async (_, mutate) => {
    const user = await openComposer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    await mutate(user);
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(confirm).toHaveBeenCalledWith("Discard this unfinished moment?");
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
