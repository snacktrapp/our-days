import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./delete-circle-action", () => ({ deleteCircleAction: mocks.remove }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
import { DeleteCircleControl } from "./delete-circle-control";
beforeEach(() => vi.clearAllMocks());
it("requires a named confirmation and supports cancellation without deletion", () => {
  render(<DeleteCircleControl circleId="empty" name="Empty" />);
  fireEvent.click(screen.getByRole("button", { name: "Delete unused circle" }));
  expect(screen.getByText(/Delete “Empty”/)).toBeVisible();
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("button", { name: "Delete circle" }),
  ).toBeNull();
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("keeps the confirmation and error visible when a populated circle cannot be deleted", async () => {
  mocks.remove.mockResolvedValue({
    ok: false,
    message: "Circle contains posts.",
  });
  render(<DeleteCircleControl circleId="home" name="Home" />);
  fireEvent.click(screen.getByRole("button", { name: "Delete unused circle" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Delete circle" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Circle contains posts.",
    ),
  );
  expect(mocks.replace).not.toHaveBeenCalled();
});
