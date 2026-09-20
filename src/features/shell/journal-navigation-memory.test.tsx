import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useJournalNavigationMemory } from "./journal-navigation-memory";

function Probe({ personId }: { personId: string }) {
  const { preferJustMe, rememberJournal } = useJournalNavigationMemory();
  return (
    <>
      <a href={preferJustMe ? `/people/${personId}` : "/family"}>Journal</a>
      <button onClick={() => rememberJournal(`/people/${personId}`)}>
        Select Just me
      </button>
    </>
  );
}

afterEach(() => sessionStorage.clear());
describe("Journal navigation memory", () => {
  it("survives remounts without remembering another user's identity", () => {
    const { unmount } = render(<Probe personId="brian" />);
    fireEvent.click(screen.getByText("Select Just me"));
    expect(sessionStorage.getItem("our-days:primary-feed")).toBe("you");
    unmount();
    render(<Probe personId="molly" />);
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute(
      "href",
      "/people/molly",
    );
  });
});
