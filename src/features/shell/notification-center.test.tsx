import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { NotificationCenter } from "./notification-center";

const items = [
  {
    id: "note-one",
    actorName: "Molly",
    message: "commented on your photo.",
    displayDate: "Today",
    href: "/family#moment-one",
  },
] as const;

describe("NotificationCenter", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens activity and clears the unread indicator", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter items={items} />);

    const trigger = screen.getByRole("button", {
      name: "Open notifications, 1 new",
    });
    await user.click(trigger);
    expect(
      screen.getByRole("region", { name: "Notifications" }),
    ).toHaveTextContent("Molly commented on your photo.");
    expect(trigger).toHaveAccessibleName("Open notifications");
    expect(
      window.localStorage.getItem("our-days:seen-notifications"),
    ).toContain("note-one");
  });
});
