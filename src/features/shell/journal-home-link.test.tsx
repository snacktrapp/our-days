import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalHomeLink } from "./journal-home-link";
import { useJournalNavigationMemory } from "./journal-navigation-memory";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function ChoosePersonal() {
  const { rememberJournal } = useJournalNavigationMemory();
  return (
    <button onClick={() => rememberJournal("/people/brian")}>Just me</button>
  );
}
afterEach(() => {
  sessionStorage.clear();
  push.mockReset();
});

describe("JournalHomeLink", () => {
  it("keeps the personal destination in the temporary loading shell", () => {
    const { unmount } = render(<ChoosePersonal />);
    fireEvent.click(screen.getByRole("button"));
    unmount();
    render(<JournalHomeLink>Journal</JournalHomeLink>);
    fireEvent.click(screen.getByRole("link", { name: "Journal" }));
    expect(push).toHaveBeenCalledWith("/journal?view=you");
  });

  it("resolves the current preference at click time, even before a repaint", () => {
    render(
      <JournalHomeLink justMeHref="/people/molly">Journal</JournalHomeLink>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/family");
    sessionStorage.setItem("our-days:primary-feed", "you");
    fireEvent.click(screen.getByRole("link"));
    expect(push).toHaveBeenCalledWith("/people/molly");
  });
});
