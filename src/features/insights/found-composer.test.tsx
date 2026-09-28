import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MomentComposer } from "@/features/composer/moment-composer";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import { foundFixtureQuote, foundFixtureRejectedQuote } from "./found-fixture";
import { foundInsightRequestBody } from "./found-types";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/family",
}));

const people = [
  {
    id: "brian",
    name: "Brian",
    initial: "B",
    accent: "teal" as const,
    contextLabel: "You",
  },
];

const baseModel: MomentComposerViewModel = {
  experience: "connected-family",
  circleId: "20000000-0000-4000-8000-000000000001",
  photoPostingEnabled: true,
  foundEnabled: true,
  viewerRole: "organizer",
  previewToday: "2026-09-27",
  defaultJournalPersonId: "brian",
  recorderPersonId: "brian",
  recordedByName: "Brian",
  journalPeople: people,
  taggablePeople: people,
  postableCircles: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Trapp Family",
      personId: "brian",
    },
  ],
};

function Harness({ model }: { model: MomentComposerViewModel }) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <MomentComposer
      model={model}
      open={open}
      returnFocusRef={triggerRef}
      onRequestClose={() => setOpen(false)}
    />
  );
}

describe("Found in the composer", () => {
  beforeEach(() => {
    navigation.refresh.mockReset();
    navigation.replace.mockReset();
    vi.unstubAllGlobals();
  });

  it("hides Found from members and when the mode is off", async () => {
    const { rerender } = render(
      <Harness model={{ ...baseModel, viewerRole: "member" }} />,
    );
    expect(
      await screen.findByRole("button", { name: /Written entry/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Found/ })).toBeNull();
    rerender(<Harness model={{ ...baseModel, foundEnabled: false }} />);
    expect(
      await screen.findByRole("button", { name: /Written entry/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Found/ })).toBeNull();
  });

  it("defaults Just me and posts the verified quote without a verified mark", async () => {
    const user = userEvent.setup();
    const candidate = {
      quote: foundFixtureQuote,
      attribution: "DHH · Lex Fridman Podcast",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=6762",
      sourceLabel: "Listen" as const,
      verifiedLabel: "Verified from transcript",
      rangeLabel: "1:52:42–1:53:04",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, candidates: [candidate] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, momentId: "moment-found-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness model={baseModel} />);
    await user.click(screen.getByRole("button", { name: /Found/ }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "What are you looking for?" }),
      "DHH on Lex",
    );
    await user.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByText(foundFixtureQuote)).toBeVisible();
    expect(screen.getByText("Verified from transcript")).toBeVisible();
    expect(screen.queryByText(foundFixtureRejectedQuote)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.getByRole("checkbox", { name: "Just me" })).toBeChecked();
    expect(screen.queryByText("Verified from transcript")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Post$/ }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/insights",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as { body: string }).body,
    );
    expect(body).toEqual(
      foundInsightRequestBody({
        quote: foundFixtureQuote,
        attribution: "DHH · Lex Fridman Podcast",
        sourceUrl: candidate.sourceUrl,
        occurredOn: "2026-09-27",
        audience: "just_me",
        circleId: "20000000-0000-4000-8000-000000000001",
        circleIds: [],
      }),
    );
    expect(body.verifiedLabel).toBeUndefined();
    expect(body.videoId).toBeUndefined();
    expect(navigation.replace).toHaveBeenCalledWith("/people/brian");
  });
});
