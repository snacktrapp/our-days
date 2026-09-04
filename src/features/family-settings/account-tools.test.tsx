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

describe("Account tools", () => {
  it("keeps recently removed and sign out as Account card rows", () => {
    render(<AccountTools />);

    expect(
      screen.getByRole("heading", { name: "Journal tools" }),
    ).toBeVisible();
    const trash = screen.getByRole("link", { name: /Recently removed/u });
    expect(trash).toHaveAttribute("href", "/trash");
    expect(trash).toHaveClass("account-tool-link");
    expect(
      screen.getByRole("button", { name: "Sign out and use another email" }),
    ).toBeVisible();
  });
});
