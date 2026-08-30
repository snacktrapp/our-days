import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MomentComposer } from "./moment-composer";

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open composer
      </button>
      <MomentComposer
        open={open}
        returnFocusRef={triggerRef}
        onRequestClose={() => setOpen(false)}
      />
    </>
  );
}

describe("MomentComposer", () => {
  it("opens as a modal, locks body scroll, and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open composer" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(
      screen.getByRole("button", { name: /Photo or video/ }),
    ).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open composer" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("preserves a draft when dismissal is declined and discards it when accepted", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open composer" }));
    await user.click(screen.getByRole("button", { name: /A thought/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Moment text" }),
      "Keep this",
    );
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(confirm).toHaveBeenCalledWith("Discard this unfinished moment?");
    expect(screen.getByRole("textbox", { name: "Moment text" })).toHaveValue(
      "Keep this",
    );

    confirm.mockReturnValue(true);
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
