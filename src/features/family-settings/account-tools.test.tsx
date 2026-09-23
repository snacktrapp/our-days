import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountTools } from "./account-tools";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: import("react").ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/auth/sign-out-button", () => ({
  SignOutButton: () => (
    <button type="button">Sign out and use another email</button>
  ),
}));

vi.mock("./web-push-actions", () => ({
  saveWebPushSubscriptionAction: vi.fn(),
  deleteWebPushSubscriptionAction: vi.fn(),
  deliverPublishedMomentPushAction: vi.fn(),
}));

describe("Account tools", () => {
  it("keeps recently removed and sign out as Settings directory rows", () => {
    render(<AccountTools />);

    const notifications = screen.getByRole("switch", { name: "Notifications" });
    expect(notifications).toBeVisible();
    expect(notifications).toBeDisabled();
    expect(screen.getByText("Not available yet.")).toBeVisible();
    expect(screen.queryByText(/Home Screen/u)).toBeNull();
    const trash = screen.getByRole("link", { name: "Recently removed" });
    expect(trash).toHaveAttribute("href", "/trash");
    expect(screen.getByText("Moments you may want back")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sign out and use another email" }),
    ).toBeVisible();
  });
});
