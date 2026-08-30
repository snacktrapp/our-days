import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MomentComposer } from "./moment-composer";

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
  currentJournalPersonId: "brian",
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

let createdUrlCount = 0;
const createObjectURL = vi.fn(
  () => `blob:composer-preview-${++createdUrlCount}`,
);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createdUrlCount = 0;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
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
  vi.restoreAllMocks();
});

async function openComposer() {
  const user = userEvent.setup({ applyAccept: false });
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Open composer" }));
  return user;
}

describe("MomentComposer", () => {
  it("opens honestly as a modal, locks body scroll, and restores focus", async () => {
    const user = await openComposer();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(
      screen.getByText(/Local design preview · Nothing is saved/u),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Photo/ })).toHaveFocus();
    expect(document.body).toHaveClass("composer-scroll-locked");

    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open composer" })).toHaveFocus();
    expect(document.body).not.toHaveClass("composer-scroll-locked");
  });

  it("previews a backdated thought with journal, people, place, and recorder context", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /A thought/ }));

    const text = screen.getByRole("textbox", { name: "Your thought" });
    const date = screen.getByLabelText("Moment date");
    const journal = screen.getByLabelText("Journal");
    expect(date).toHaveValue("2026-08-28");
    expect(journal).toHaveValue("brian");
    expect(text.closest("form")).not.toBeNull();
    expect((text.closest("form") as HTMLFormElement).checkValidity()).toBe(
      false,
    );

    await user.type(text, "A brave blue door.");
    fireEvent.change(date, { target: { value: "2023-08-21" } });
    await user.selectOptions(journal, "avery");
    await user.click(screen.getByRole("button", { name: /People and place/ }));
    await user.click(screen.getByRole("checkbox", { name: /Molly/ }));
    await user.type(screen.getByLabelText(/^Place/u), "Oak Street School");
    await user.click(screen.getByRole("button", { name: "Preview moment" }));

    const reviewHeading = screen.getByRole("heading", {
      name: "A preview of this moment",
    });
    expect(reviewHeading).toBeVisible();
    expect(reviewHeading).toHaveFocus();
    expect(
      screen.getByText("Design preview · Nothing was saved"),
    ).toBeVisible();
    expect(screen.getByText("A brave blue door.")).toBeVisible();
    expect(screen.getByText("Aug 21, 2023")).toBeVisible();
    expect(screen.getByText("Avery")).toBeVisible();
    expect(screen.getByText("Molly")).toBeVisible();
    expect(screen.getByText("Oak Street School")).toBeVisible();
    expect(screen.getByText("Recorded by Brian")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.getByRole("textbox", { name: "Your thought" })).toHaveValue(
      "A brave blue door.",
    );
    expect(screen.getByLabelText("Moment date")).toHaveValue("2023-08-21");
    expect(screen.getByLabelText("Journal")).toHaveValue("avery");
    expect(screen.getByRole("checkbox", { name: /Molly/ })).toBeChecked();
    expect(screen.getByLabelText(/^Place/u)).toHaveValue("Oak Street School");

    await user.click(screen.getByRole("button", { name: "Preview moment" }));
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open composer" }));
    expect(screen.getByRole("button", { name: /A thought/ })).toBeVisible();
    expect(screen.queryByDisplayValue("A brave blue door.")).toBeNull();
  });

  it.each([
    ["Milestone", "Milestone", "First day of school"],
    ["A place", "Place name", "Sand Harbor"],
  ])("gives %s a distinct required title", async (choice, label, value) => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: new RegExp(choice) }));
    const requiredTitle = screen.getByLabelText(label);
    expect(requiredTitle).toBeRequired();
    await user.type(requiredTitle, value);
    await user.click(screen.getByRole("button", { name: "Preview moment" }));
    expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  });

  it("preserves a draft while choosing and confirms an incompatible type change", async () => {
    const user = await openComposer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: /A thought/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Your thought" }),
      "Keep this",
    );
    await user.click(screen.getByRole("button", { name: /Choose another/ }));
    expect(screen.getByText("Your current draft is still here.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /A thought/ }));
    expect(screen.getByRole("textbox", { name: "Your thought" })).toHaveValue(
      "Keep this",
    );
    await user.click(screen.getByRole("button", { name: /Choose another/ }));
    await user.click(screen.getByRole("button", { name: /Milestone/ }));
    expect(confirm).toHaveBeenCalledWith(
      "Discard this draft and choose another type?",
    );
    expect(screen.getByText("Your current draft is still here.")).toBeVisible();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /Milestone/ }));
    expect(screen.getByLabelText("Milestone")).toHaveValue("");
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
    expect(
      screen.getByRole("button", { name: "Preview moment" }),
    ).toBeVisible();
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
    expect(
      screen.getByRole("heading", { name: "A preview of this moment" }),
    ).toBeVisible();
  });

  it("returns safely to edit if a decoded photo fails in review", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    const picker = screen.getByLabelText(/Choose photo/u);
    await user.upload(
      picker,
      new File(["photo"], "private.jpg", { type: "image/jpeg" }),
    );
    fireEvent.load(screen.getByAltText("Selected photo preview"));
    fireEvent.submit(picker.closest("form")!);
    const reviewImage = document.querySelector<HTMLImageElement>(
      ".composer-review img",
    );
    expect(reviewImage).not.toBeNull();

    fireEvent.error(reviewImage!);

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:composer-preview-1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This image could not be shown. Choose another one.",
    );
    expect(screen.queryByText("Design preview · Nothing was saved")).toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText(/Choose photo/u)).toHaveFocus(),
    );
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
    await user.click(screen.getByRole("button", { name: "Close preview" }));
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
    await user.click(screen.getByRole("button", { name: /Milestone/ }));

    expect(confirm).toHaveBeenCalledWith(
      "Discard this draft and choose another type?",
    );
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:composer-preview-1");
    expect(screen.getByLabelText("Milestone")).toBeVisible();
  });

  it.each([
    ["A thought", "Your thought", "Write a thought"],
    ["Milestone", "Milestone", "Name the milestone"],
    ["A place", "Place name", "Name the place"],
  ])(
    "rejects whitespace-only required content for %s",
    async (choice, label, error) => {
      const user = await openComposer();
      await user.click(
        screen.getByRole("button", { name: new RegExp(choice) }),
      );
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value: " \n " } });
      await user.click(screen.getByRole("button", { name: "Preview moment" }));

      expect(screen.getByRole("alert")).toHaveTextContent(error);
      expect(field).toHaveFocus();
      expect(
        screen.queryByRole("heading", { name: "A preview of this moment" }),
      ).toBeNull();
    },
  );

  it("removes a stale self-tag when its person becomes the journal", async () => {
    const user = await openComposer();
    await user.click(screen.getByRole("button", { name: /A thought/ }));
    await user.click(screen.getByRole("button", { name: /People and place/ }));
    const avery = screen.getByRole("checkbox", { name: /Avery/ });
    await user.click(avery);
    expect(avery).toBeChecked();

    await user.selectOptions(screen.getByLabelText("Journal"), "avery");
    expect(avery).not.toBeChecked();
    expect(avery).toBeDisabled();
  });

  it.each([
    [
      "whitespace text",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(
          screen.getByRole("textbox", { name: "Your thought" }),
          " ",
        );
      },
    ],
    [
      "date",
      async () => {
        fireEvent.change(screen.getByLabelText("Moment date"), {
          target: { value: "2020-01-01" },
        });
      },
    ],
    [
      "journal",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.selectOptions(screen.getByLabelText("Journal"), "avery");
      },
    ],
    [
      "people tag",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          screen.getByRole("button", { name: /People and place/ }),
        );
        await user.click(screen.getByRole("checkbox", { name: /Molly/ }));
      },
    ],
    [
      "place",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          screen.getByRole("button", { name: /People and place/ }),
        );
        await user.type(screen.getByLabelText(/^Place/u), "The porch");
      },
    ],
  ])("treats a changed %s as a protected draft", async (_, mutate) => {
    const user = await openComposer();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: /A thought/ }));
    await mutate(user);
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(confirm).toHaveBeenCalledWith("Discard this unfinished moment?");
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
