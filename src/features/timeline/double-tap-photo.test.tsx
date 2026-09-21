import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DoubleTapPhoto } from "./double-tap-photo";

function setup() {
  const { container } = render(
    <>
      <DoubleTapPhoto momentId="photo">Photo</DoubleTapPhoto>
      <div id="moment-conversation-photo" />
    </>,
  );
  const target = container.querySelector(".double-tap-photo")!;
  const love = vi.fn();
  container
    .querySelector("#moment-conversation-photo")!
    .addEventListener("our-days:heart", love);
  const pointer = {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 50,
    clientY: 50,
  };
  const tap = () => {
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerUp(target, pointer);
  };
  return { target, pointer, love, tap };
}

describe("photo love gesture", () => {
  it("only loves after two nearby taps", () => {
    const { tap, love } = setup();
    tap();
    expect(love).not.toHaveBeenCalled();
    tap();
    expect(love).toHaveBeenCalledOnce();
  });
  it("does not count swipes, even when the pointer returns to its starting point", () => {
    const { target, pointer, tap, love } = setup();
    tap();
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerMove(target, { ...pointer, clientX: 150 });
    fireEvent.pointerUp(target, pointer);
    tap();
    expect(love).not.toHaveBeenCalled();
  });
  it("clears a cancelled scroll and ignores secondary pointers", () => {
    const { target, pointer, tap, love } = setup();
    tap();
    fireEvent.pointerCancel(target, pointer);
    tap();
    expect(love).not.toHaveBeenCalled();
    fireEvent.pointerDown(target, { ...pointer, isPrimary: false });
    fireEvent.pointerUp(target, pointer);
    tap();
    expect(love).not.toHaveBeenCalled();
  });
});
